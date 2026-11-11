import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { dietEntries, dietMessages, dietPhotos, dietProfiles, dietWeights, workoutSets } from '@/db/schema';
import { stripDietBlocks, sumTotals, type CoachState, type DietAction } from './protocol';
import { advise, adviceLines } from './advisor';

/** The calendar day `n` days before `day` (both YYYY-MM-DD). */
export function shiftDay(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function getProfile(db: DB, userId: string) {
  const [p] = await db.select().from(dietProfiles).where(eq(dietProfiles.userId, userId));
  return p ?? null;
}

type ProfilePatch = Partial<Pick<typeof dietProfiles.$inferInsert, 'sex' | 'age' | 'heightCm' | 'goal' | 'calories' | 'protein' | 'fat' | 'carbs' | 'notes' | 'activity' | 'goalWeightKg' | 'photoId' | 'trainDays' | 'sessionMinutes' | 'experience' | 'equipment' | 'injuries' | 'lastCheckin'>>;

export async function updateProfile(db: DB, userId: string, patch: ProfilePatch) {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as ProfilePatch;
  if (!Object.keys(clean).length) return;
  for (const k of ['age', 'calories', 'protein', 'fat', 'carbs', 'trainDays', 'sessionMinutes'] as const) if (clean[k] != null) clean[k] = Math.round(clean[k]!);
  await db.insert(dietProfiles).values({ userId, ...clean, updatedAt: new Date() })
    .onConflictDoUpdate({ target: dietProfiles.userId, set: { ...clean, updatedAt: new Date() } });
}

export async function listEntries(db: DB, userId: string, day: string) {
  return db.select().from(dietEntries).where(and(eq(dietEntries.userId, userId), eq(dietEntries.day, day))).orderBy(asc(dietEntries.id));
}

export async function deleteEntry(db: DB, userId: string, id: number) {
  const gone = await db.delete(dietEntries).where(and(eq(dietEntries.id, id), eq(dietEntries.userId, userId))).returning({ id: dietEntries.id });
  return gone.length > 0;
}

export async function setWeight(db: DB, userId: string, day: string, kg: number) {
  await db.insert(dietWeights).values({ userId, day, kg }).onConflictDoUpdate({ target: [dietWeights.userId, dietWeights.day], set: { kg } });
}

/** Per-day totals for the `days` days up to and including `day` (days with nothing logged left out). */
export async function dayTotals(db: DB, userId: string, day: string, days = 7) {
  const rows = await db
    .select({
      day: dietEntries.day,
      kcal: sql<number>`sum(${dietEntries.kcal})::float8`,
      protein: sql<number>`sum(${dietEntries.protein})::float8`,
      fat: sql<number>`sum(${dietEntries.fat})::float8`,
      carbs: sql<number>`sum(${dietEntries.carbs})::float8`,
    })
    .from(dietEntries)
    .where(and(eq(dietEntries.userId, userId), gte(dietEntries.day, shiftDay(day, -(days - 1))), lte(dietEntries.day, day)))
    .groupBy(dietEntries.day)
    .orderBy(asc(dietEntries.day));
  return rows;
}

export async function listWeights(db: DB, userId: string, limit = 60) {
  const rows = await db.select({ day: dietWeights.day, kg: dietWeights.kg }).from(dietWeights)
    .where(eq(dietWeights.userId, userId)).orderBy(desc(dietWeights.day)).limit(limit);
  return rows.reverse();
}

export async function listDietMessages(db: DB, userId: string, limit = 200) {
  const rows = await db.select({ id: dietMessages.id, role: dietMessages.role, content: dietMessages.content, provider: dietMessages.provider })
    .from(dietMessages).where(eq(dietMessages.userId, userId)).orderBy(desc(dietMessages.id)).limit(limit);
  return rows.reverse();
}

export async function addDietMessage(db: DB, userId: string, m: { role: 'user' | 'assistant'; content: string; provider?: string | null }) {
  const [row] = await db.insert(dietMessages).values({ userId, ...m }).returning({ id: dietMessages.id });
  return row.id;
}

export async function deleteDietMessage(db: DB, userId: string, id: number) {
  await db.delete(dietMessages).where(and(eq(dietMessages.id, id), eq(dietMessages.userId, userId)));
}

export async function clearDietMessages(db: DB, userId: string) {
  await db.delete(dietMessages).where(eq(dietMessages.userId, userId));
}

/** Everything the page shows for one day, with the advisor's numbers as of `today`. */
export async function dietState(db: DB, userId: string, day: string, today = day) {
  const [profile, entries, month, weights, photos] = await Promise.all([
    getProfile(db, userId), listEntries(db, userId, day), dayTotals(db, userId, today, 28), listWeights(db, userId, 365), listPhotos(db, userId),
  ]);
  const week = month.filter((d) => d.day > shiftDay(day, -7) && d.day <= day);
  const advice = advise(profile, weights, month, today);
  return { day, profile, entries, totals: sumTotals(entries), week, weights, advice, photos };
}

/** What the coach is told before it answers (yesterday and before, not today: today is listed item by item). */
export async function coachState(db: DB, userId: string, today: string): Promise<CoachState> {
  const s = await dietState(db, userId, today);
  // the latest read of each pose, so the coach remembers what the photos showed
  const latest = new Map<string, (typeof s.photos)[number]>();
  for (const ph of s.photos) if (ph.analysis && !latest.has(ph.pose)) latest.set(ph.pose, ph);
  return {
    today, profile: s.profile, entries: s.entries, week: s.week.filter((d) => d.day !== today), weights: s.weights.slice(-30),
    advice: adviceLines(s.advice, s.profile),
    physique: [...latest.values()].map((ph) => ({ day: ph.day, pose: ph.pose, bodyFat: bodyFatText(ph), summary: ph.summary ?? '' })),
  };
}

/* ---------------------------------------------------------------- progress photos */

export const bodyFatText = (p: { bodyFatLow: number | null; bodyFatHigh: number | null }) =>
  p.bodyFatLow == null ? null : p.bodyFatHigh != null && p.bodyFatHigh !== p.bodyFatLow ? `${p.bodyFatLow}–${p.bodyFatHigh}` : `${p.bodyFatLow}`;

/** Newest first, without the picture bytes. `summary` is the analysis's one-line takeaway. */
export async function listPhotos(db: DB, userId: string, limit = 200) {
  return db.select({
    id: dietPhotos.id, day: dietPhotos.day, pose: dietPhotos.pose, kg: dietPhotos.kg,
    bodyFatLow: dietPhotos.bodyFatLow, bodyFatHigh: dietPhotos.bodyFatHigh, analysis: dietPhotos.analysis, summary: dietPhotos.summary,
    createdAt: dietPhotos.createdAt,
  }).from(dietPhotos).where(eq(dietPhotos.userId, userId)).orderBy(desc(dietPhotos.day), desc(dietPhotos.id)).limit(limit);
}

export async function addPhoto(db: DB, userId: string, p: { day: string; pose: string; data: Buffer; kg: number | null }) {
  const [row] = await db.insert(dietPhotos).values({ userId, ...p }).returning({ id: dietPhotos.id });
  return row.id;
}

export async function saveAnalysis(db: DB, userId: string, id: number, a: { text: string; bodyFatLow: number | null; bodyFatHigh: number | null; summary: string | null }) {
  await db.update(dietPhotos).set({ analysis: a.text, summary: a.summary, bodyFatLow: a.bodyFatLow, bodyFatHigh: a.bodyFatHigh })
    .where(and(eq(dietPhotos.id, id), eq(dietPhotos.userId, userId)));
}

/** A photo's bytes, only for its owner. */
export async function readPhoto(db: DB, userId: string, id: number) {
  const [row] = await db.select({ data: dietPhotos.data }).from(dietPhotos).where(and(eq(dietPhotos.id, id), eq(dietPhotos.userId, userId)));
  return row ? Buffer.from(row.data) : null;
}

export async function deletePhoto(db: DB, userId: string, id: number) {
  const gone = await db.delete(dietPhotos).where(and(eq(dietPhotos.id, id), eq(dietPhotos.userId, userId))).returning({ id: dietPhotos.id });
  if (!gone.length) return false;
  await db.update(dietProfiles).set({ photoId: null }).where(and(eq(dietProfiles.userId, userId), eq(dietProfiles.photoId, id)));
  return true;
}

// words that name a food ("salmon", "onigiri", "savas"), for telling a re-sent item from a new one
const foodWords = (name: string) => name.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [];

/**
 * Record what a coach reply asked for, and return what was really applied (the page shows that, not the
 * raw block). Models re-send state: the food already logged with the next item, the same weight and
 * targets every turn. An item matching one already logged that day is skipped unless the user's message
 * names it ("another SAVAS" still logs a second one); weight, targets and profile count only when they change.
 */
export async function applyDietActions(db: DB, userId: string, today: string, actions: DietAction[], userText = '') {
  const said = userText.toLowerCase();
  const applied: DietAction = {};
  const profile = await getProfile(db, userId);
  for (const a of actions) {
    if (a.remove?.length) {
      const todays = await listEntries(db, userId, today);
      for (const name of a.remove) {
        const want = name.toLowerCase();
        // the latest entry whose name matches (exactly, else contains): "rice cake" takes back "1 rice cake (10 g)"
        const hit = [...todays].reverse().find((e) => e.name.toLowerCase() === want) ?? [...todays].reverse().find((e) => e.name.toLowerCase().includes(want));
        if (hit && await deleteEntry(db, userId, hit.id)) { (applied.remove ??= []).push(hit.name); todays.splice(todays.indexOf(hit), 1); }
      }
    }
    for (const i of a.log ?? []) {
      const day = i.day ?? today;
      const already = (await listEntries(db, userId, day)).some((e) => e.name.toLowerCase() === i.name.toLowerCase() && Math.round(e.kcal) === Math.round(i.kcal));
      if (already && !foodWords(i.name).some((w) => said.includes(w))) continue;
      await db.insert(dietEntries).values({ userId, day, meal: i.meal, name: i.name, kcal: i.kcal, protein: i.protein, fat: i.fat, carbs: i.carbs });
      (applied.log ??= []).push(i);
    }
    if (a.workout?.length) {
      // the same sets already logged today are a re-send, not a second workout
      const todays = await db.select({ exercise: workoutSets.exercise, kg: workoutSets.kg, reps: workoutSets.reps }).from(workoutSets)
        .where(and(eq(workoutSets.userId, userId), eq(workoutSets.day, today)));
      const seen = new Set(todays.map((t) => `${t.exercise.toLowerCase()}|${t.kg}|${t.reps}`));
      const fresh = a.workout.filter((w) => !seen.has(`${w.exercise.toLowerCase()}|${w.kg}|${w.reps}`));
      const rows = fresh.flatMap((w) => Array.from({ length: w.sets }, () => ({ userId, day: today, exercise: w.exercise, kg: w.kg, reps: w.reps })));
      if (rows.length) { await db.insert(workoutSets).values(rows); applied.workout = [...(applied.workout ?? []), ...fresh]; }
    }
    if (a.replan) applied.replan = a.replan; // carried out by the chat route once the reply is saved
    if (a.weight) {
      const [w] = await db.select({ kg: dietWeights.kg }).from(dietWeights).where(and(eq(dietWeights.userId, userId), eq(dietWeights.day, today)));
      if (w?.kg !== a.weight) { await setWeight(db, userId, today, a.weight); applied.weight = a.weight; }
    }
    for (const key of ['targets', 'profile'] as const) {
      const changed = Object.fromEntries(Object.entries(a[key] ?? {}).filter(([k, v]) => {
        const now = (profile as Record<string, unknown> | null)?.[k];
        return v != null && (typeof v === 'number' ? Math.round(v) !== now && v !== now : v !== now);
      }));
      if (Object.keys(changed).length) {
        await updateProfile(db, userId, changed);
        applied[key] = { ...applied[key], ...changed };
        if (profile) Object.assign(profile, changed);
      }
    }
  }
  return applied;
}

/** A reply as it's saved: its words, then one block of what was really recorded (none if nothing was). */
export function savedReply(text: string, applied: DietAction) {
  const words = stripDietBlocks(text);
  return Object.keys(applied).length ? `${words}\n\n\`\`\`diet\n${JSON.stringify(applied)}\n\`\`\`` : words;
}

export async function deleteWeight(db: DB, userId: string, day: string) {
  await db.delete(dietWeights).where(and(eq(dietWeights.userId, userId), eq(dietWeights.day, day)));
}
