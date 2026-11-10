// The weekly check-in: once a week the coach looks back at the last 7 days (weight trend against a
// sensible pace, how closely they ate to target, lifts, photos) and posts a short review with one or two
// adjustments into the coach conversation, like a coach's Monday message.
import { eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { dietProfiles } from '@/db/schema';
import { completeText } from '@/server/complete';
import { advise, adviceLines } from './advisor';
import { addDietMessage, dayTotals, getProfile, listPhotos, listWeights, shiftDay, updateProfile } from './service';
import { currentPlan, listSets } from './plan';
import { performanceLines } from './training';

export const CHECKIN_TITLE = '📋 **Weekly check-in**';
const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/** Due once 7 days have passed since the last one; the first one waits for 3 logged days or 2 weigh-ins. */
export function checkinDue(lastCheckin: string | null | undefined, today: string, loggedDays: number, weighIns: number) {
  if (lastCheckin) return dayNum(today) - dayNum(lastCheckin) >= 7;
  return loggedDays >= 3 || weighIns >= 2;
}

export async function isCheckinDue(db: DB, userId: string, today: string) {
  const [p, logs, weights] = await Promise.all([getProfile(db, userId), dayTotals(db, userId, today, 7), listWeights(db, userId, 14)]);
  return checkinDue(p?.lastCheckin, today, logs.length, weights.filter((w) => w.day > shiftDay(today, -8)).length);
}

export function checkinPrompt(c: { advice: string; week: string; weights: string; lifts: string; physique: string; plan: string | null; targets: string }) {
  return `You are the client's physique coach writing their weekly check-in (the Monday message). Use only these numbers:
- Targets: ${c.targets}
- Computed: \n${c.advice}
- Last 7 days of food: ${c.week || 'nothing logged'}
- Weigh-ins (last 2 weeks): ${c.weights || 'none'}
- Lifts (last 2 weeks): ${c.lifts || 'none logged'}
- Progress photos: ${c.physique || 'none'}
- Training plan: ${c.plan ?? 'none yet'}

Write at most ~140 words, plain markdown, no heading:
1. One line on how the week went (honest; name a real win if there is one).
2. Weight trend against the sensible pace — on track, too fast, too slow, or not enough weigh-ins.
3. Adherence: days logged and how close to calories and protein.
4. **This week:** one or two specific adjustments (e.g. "calories 2,150 → 2,050", "protein 30 g higher: add a SAVAS shake after training", "add 2 sets of lateral raises", "weigh in 3+ mornings"). If they're on track, say keep going and give one focus.
Don't invent numbers that aren't above. Don't log anything.`;
}

export async function generateCheckin(db: DB, userId: string, today: string): Promise<{ ok: true; text: string } | { ok: false; status: number; message: string }> {
  const [profile, month, weights, photos, sets, plan] = await Promise.all([
    getProfile(db, userId), dayTotals(db, userId, today, 28), listWeights(db, userId, 60), listPhotos(db, userId, 4),
    listSets(db, userId, shiftDay(today, -14)), currentPlan(db, userId),
  ]);
  const advice = advise(profile, weights, month, today);
  const week = month.filter((d) => d.day > shiftDay(today, -8) && d.day < today);
  const res = await completeText(userId, [{ role: 'user', content: checkinPrompt({
    advice: adviceLines(advice, profile),
    targets: profile?.calories ? `${profile.calories} kcal · P ${profile.protein ?? '?'} · F ${profile.fat ?? '?'} · C ${profile.carbs ?? '?'}` : 'not set',
    week: week.map((d) => `${d.day} ${Math.round(d.kcal)} kcal P${Math.round(d.protein)}`).join(', '),
    weights: weights.filter((w) => w.day > shiftDay(today, -15)).map((w) => `${w.day} ${w.kg}`).join(', '),
    lifts: performanceLines(sets),
    physique: photos.filter((p) => p.summary).map((p) => `${p.day} ${p.pose}: ${p.summary}`).join(' | '),
    plan: plan?.plan.name ?? null,
  }) }], { task: 'reasoning', temperature: 0.3, session: `diet:${userId}` });
  if (!res.ok) return res;
  const text = `${CHECKIN_TITLE}\n\n${res.text.replace(/```[\s\S]*?```/g, '').trim()}`;
  await addDietMessage(db, userId, { role: 'assistant', content: text, provider: res.provider });
  await updateProfile(db, userId, { lastCheckin: today });
  return { ok: true, text };
}

/** For tests and the page: clears the date so the next check-in is due now. */
export async function resetCheckin(db: DB, userId: string) {
  await db.update(dietProfiles).set({ lastCheckin: null }).where(eq(dietProfiles.userId, userId));
}
