import { exactItem } from './foods';
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import { dietEntries, dietMessages, dietPhotos, dietProfiles, dietWeights, workoutSets } from '@/db/schema';
import { stripDietBlocks, sumTotals, withoutModelTotals, type CoachState, type DietAction } from './protocol';
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
  const yesterday = shiftDay(today, -1);
  const [s, mine, before] = await Promise.all([dietState(db, userId, today), myFoods(db, userId), listEntries(db, userId, yesterday)]);
  // the latest read of each pose, so the coach remembers what the photos showed
  const latest = new Map<string, (typeof s.photos)[number]>();
  for (const ph of s.photos) if (ph.analysis && !latest.has(ph.pose)) latest.set(ph.pose, ph);
  return {
    today, myFoods: mine, yesterday: { day: yesterday, entries: before }, profile: s.profile, entries: s.entries, week: s.week.filter((d) => d.day !== today), weights: s.weights.slice(-30),
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
// what a food's missing energy most likely is, when its P/F/C don't add up to its kcal
const CARBY = /\b(rice|sushi|nigiri|gunkan|maki|roll|onigiri|bread|toast|sandwich|noodles?|ramen|udon|soba|pasta|oats?|oatmeal|banana|fruit|juice|latte|coffee|tea|milk|shake|smoothie|yogh?urt|cake|cookie|bar|sweet|candy|potato|cereal|drink|soda|beer|curry|bowl|don|gyudon)\b|ご飯|飯|寿司|鮨|おにぎり|パン|麺|ラテ|丼/i;
const FATTY = /\b(salmon|mackerel|saba|toro|eel|unagi|beef|pork|lamb|bacon|sausage|egg|eggs|cheese|nuts?|almonds?|peanuts?|oil|butter|mayo|mayonnaise|avocado|karaage|fried|tempura|katsu|cream)\b|サーモン|鯖|トロ|マヨ|唐揚|天ぷら/i;
const NO_CARBS = /\b(no|without) rice\b|rice removed|\bsashimi\b|刺身/i;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * An item whose protein, fat and carbs don't add up to its calories (P×4 + C×4 + F×9 more than ~15% off) is
 * corrected: the kcal and protein stay (they come from the menu or label, or were asked for), fat and carbs
 * are set so they add up — the missing energy goes to carbs for rice, bread and drinks, to fat for fish
 * without rice and fatty foods. (The coach logged salmon at 0 g fat and sushi with half its rice carbs.)
 */
export function balanceMacros<T extends { name: string; kcal: number; protein: number; fat: number; carbs: number }>(i: T): { item: T; fixed: boolean } {
  const atwater = 4 * i.protein + 4 * i.carbs + 9 * i.fat;
  if (i.kcal < 30 || Math.abs(atwater - i.kcal) <= Math.max(15, i.kcal * 0.15)) return { item: i, fixed: false };
  // protein alone is more than the calories: the kcal is the wrong number, not the macros
  if (4 * i.protein >= i.kcal) return { item: { ...i, kcal: Math.round(atwater) }, fixed: true };
  let { fat, carbs } = i;
  if (atwater < i.kcal) {
    const gap = i.kcal - atwater;
    const carby = CARBY.test(i.name), fatty = FATTY.test(i.name);
    const toCarbs = NO_CARBS.test(i.name) ? 0 : carby && fatty ? 0.6 : carby ? 1 : fatty ? 0 : 0.5;
    carbs += (gap * toCarbs) / 4;
    fat += (gap * (1 - toCarbs)) / 9;
  } else {
    // more energy in the macros than the calories: fat and carbs shrink to fit (protein is the one people count)
    const room = i.kcal - 4 * i.protein, fc = 4 * carbs + 9 * fat;
    if (fc > 0) { carbs *= room / fc; fat *= room / fc; }
  }
  return { item: { ...i, fat: r1(fat), carbs: r1(carbs) }, fixed: true };
}

/** The same food again: by name, or by the same numbers under another name ("restaurant meal" = "estimated meal"). */
function sameEntry(e: { name: string; kcal: number; protein: number; fat: number; carbs: number }, i: { name: string; kcal: number; protein: number; fat: number; carbs: number }) {
  if (Math.round(e.kcal) !== Math.round(i.kcal)) return false;
  return e.name.toLowerCase() === i.name.toLowerCase() || (i.kcal >= 50 && Math.abs(e.protein - i.protein) <= 1 && Math.abs(e.fat - i.fat) <= 1.5 && Math.abs(e.carbs - i.carbs) <= 1.5);
}

const foodWords = (name: string) => name.toLowerCase().match(/[\p{L}]{4,}/gu) ?? [];

/**
 * Record what a coach reply asked for, and return what was really applied (the page shows that, not the
 * raw block). Models re-send state: the food already logged with the next item, the same weight and
 * targets every turn. An item matching one already logged that day is skipped unless the user's message
 * names it ("another SAVAS" still logs a second one); weight, targets and profile count only when they change.
 */
export async function applyDietActions(db: DB, userId: string, today: string, actions: DietAction[], userText = '', balanced: string[] = []) {
  const said = userText.toLowerCase();
  let known: Awaited<ReturnType<typeof myFoods>> | undefined;
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
    for (const raw of a.log ?? []) {
      // exact numbers: a table food with an amount, else the same food as they logged before
      const exact = exactNumbers(raw, known ??= await myFoods(db, userId));
      // the numbers have to add up (table foods and their own foods already do)
      const { item: i, fixed } = exact === raw ? balanceMacros(exact) : { item: exact, fixed: false };
      if (fixed) balanced.push(i.name);
      const day = i.day ?? today;
      // re-sent food: a follow-up ("also add 400 kcal for yesterday") came back with yesterday's meal again
      const already = (await listEntries(db, userId, day)).some((e) => sameEntry(e, i));
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
const sameFood = (s: string) => s.toLowerCase().replace(/[(（][^)）]*[)）]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The foods this user has logged in the last 90 days, most often first (their SAVAS latte, their usual
 * rice): the coach reuses these numbers, and the same food logged again gets them exactly.
 */
export async function myFoods(db: DB, userId: string, limit = 40) {
  const rows = await db.select({ name: dietEntries.name, kcal: dietEntries.kcal, protein: dietEntries.protein, fat: dietEntries.fat, carbs: dietEntries.carbs, day: dietEntries.day, id: dietEntries.id })
    .from(dietEntries).where(and(eq(dietEntries.userId, userId), gte(dietEntries.day, shiftDay(new Date().toISOString().slice(0, 10), -90))))
    .orderBy(desc(dietEntries.day), desc(dietEntries.id)).limit(1500);
  const seen = new Map<string, { name: string; kcal: number; protein: number; fat: number; carbs: number; n: number }>();
  for (const r of rows) {
    const k = sameFood(r.name);
    const hit = seen.get(k);
    if (hit) hit.n++; // the newest numbers win (rows are newest first)
    else seen.set(k, { name: r.name, kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs, n: 1 });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((f) => ({ name: f.name, kcal: f.kcal, protein: f.protein, fat: f.fat, carbs: f.carbs }));
}

/** A logged item with exact numbers: from the food table when it's a table food with an amount, else
 *  copied from the same food logged before (same name), else as the model gave it. */
export function exactNumbers<T extends { name: string; kcal: number; protein: number; fat: number; carbs: number }>(item: T, known: { name: string; kcal: number; protein: number; fat: number; carbs: number }[]): T {
  const fromTable = exactItem(item);
  if (fromTable !== item) return fromTable;
  const k = sameFood(item.name);
  const same = known.find((f) => sameFood(f.name) === k);
  return same ? { ...item, kcal: same.kcal, protein: same.protein, fat: same.fat, carbs: same.carbs } : item;
}

export function savedReply(text: string, applied: DietAction, today?: string) {
  const words = today ? `${withoutModelTotals(stripDietBlocks(text))}\n\n${today}` : stripDietBlocks(text);
  return Object.keys(applied).length ? `${words}\n\n\`\`\`diet\n${JSON.stringify(applied)}\n\`\`\`` : words;
}

export async function deleteWeight(db: DB, userId: string, day: string) {
  await db.delete(dietWeights).where(and(eq(dietWeights.userId, userId), eq(dietWeights.day, day)));
}
