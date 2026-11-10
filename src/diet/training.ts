// Training: the plan the coach writes (validated JSON), the prompt that writes it, and progressive
// overload — what weight and reps to aim for next time, from what was lifted last time.
import { z } from 'zod';

export const EXPERIENCE = ['beginner', 'intermediate', 'advanced'] as const;
export const EQUIPMENT = { gym: 'Full gym', home: 'Home gym (rack, barbell, dumbbells)', dumbbells: 'Dumbbells only', bodyweight: 'Bodyweight only' } as const;
export type Equipment = keyof typeof EQUIPMENT;

const exercise = z.object({
  name: z.string().trim().min(2).max(80),
  sets: z.coerce.number().int().min(1).max(10),
  reps: z.string().trim().min(1).max(20), // "6-8", "10-12", "AMRAP", "30-45 s"
  restSec: z.coerce.number().int().min(15).max(600).default(90),
  note: z.string().trim().max(160).optional(),
});
const day = z.object({
  name: z.string().trim().min(1).max(60), // "Upper A", "Push"
  focus: z.string().trim().max(120).default(''),
  exercises: z.array(exercise).min(1).max(12),
});
export const planSchema = z.object({
  name: z.string().trim().min(2).max(80), // "Upper/Lower, 4 days"
  why: z.string().trim().max(600).default(''),
  days: z.array(day).min(1).max(7),
  notes: z.array(z.string().trim().max(240)).max(8).default([]),
});
export type TrainingPlan = z.infer<typeof planSchema>;
export type PlanExercise = z.infer<typeof exercise>;

export type TrainingDetails = {
  trainDays?: number | null; sessionMinutes?: number | null; experience?: string | null; equipment?: string | null; injuries?: string | null;
  sex?: string | null; age?: number | null; heightCm?: number | null; goal?: string | null;
};

export const detailsMissing = (d: TrainingDetails) =>
  [!d.trainDays && 'days per week', !d.sessionMinutes && 'minutes per session', !d.experience && 'experience', !d.equipment && 'equipment'].filter(Boolean) as string[];

/** Minutes a day of the plan takes: about (rest + 40 s of lifting) per set, plus 8 minutes of warm-up. */
export const dayMinutes = (d: TrainingPlan['days'][number]) => Math.round(8 + d.exercises.reduce((a, e) => a + (e.sets * (e.restSec + 40)) / 60, 0));

/** What's wrong with a plan for these details (empty when it's fine): duplicates, wrong day count, too long. */
export function planProblems(p: TrainingPlan, d: TrainingDetails): string[] {
  const out: string[] = [];
  if (d.trainDays && p.days.length !== d.trainDays) out.push(`it has ${p.days.length} days but they train ${d.trainDays} days a week`);
  for (const day of p.days) {
    const seen = new Set<string>();
    for (const e of day.exercises) {
      const k = e.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seen.has(k)) out.push(`"${e.name}" appears twice in ${day.name}`);
      seen.add(k);
    }
    const single = day.exercises.filter((e) => e.sets < 2).map((e) => e.name);
    if (single.length) out.push(`${day.name} has 1-set exercises (${single.join(', ')}) — give them 2+ sets or drop them`);
    const mins = dayMinutes(day);
    if (d.sessionMinutes && mins > d.sessionMinutes * 1.15) out.push(`${day.name} takes about ${mins} minutes (${day.exercises.length} exercises, ${day.exercises.reduce((a, e) => a + e.sets, 0)} sets) but they have ${d.sessionMinutes} — cut exercises or sets, keeping the priorities`);
  }
  return out;
}

/** The coach's answer: a short "what changed" note, then a ```plan block of JSON. */
export function parsePlanReply(reply: string): { plan: TrainingPlan; change: string } | { error: string } {
  const m = /```(?:plan|json)\s*\n([\s\S]*?)```/.exec(reply) ?? /(\{[\s\S]*"days"[\s\S]*\})/.exec(reply);
  if (!m) return { error: 'no ```plan block' };
  let json: unknown;
  try { json = JSON.parse(m[1]); } catch (e) { return { error: `the plan is not valid JSON (${e instanceof Error ? e.message : 'parse error'})` }; }
  const r = planSchema.safeParse(json);
  if (!r.success) return { error: `the plan does not match the format: ${r.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
  const change = reply.slice(0, m.index).replace(/^#+\s*/gm, '').trim().slice(0, 1200);
  return { plan: r.data, change };
}

export type PlanContext = {
  details: TrainingDetails;
  weightKg: number | null;
  lagging: string[]; // reads of their progress photos (newest first)
  current: TrainingPlan | null;
  instruction: string | null; // what they asked for, or why the plan is being revisited
  performance: string; // recent lifts (performanceLines)
};

export function planPrompt(c: PlanContext): string {
  const d = c.details;
  const about = [d.sex, d.age && `${d.age} y`, d.heightCm && `${d.heightCm} cm`, c.weightKg && `${c.weightKg} kg`, d.goal && `goal: ${d.goal}`].filter(Boolean).join(', ');
  return `You are an expert strength and hypertrophy coach. ${c.current ? 'Revise this client\'s training plan.' : 'Write this client\'s training plan.'}

Client: ${about || 'details not given'}
- Trains ${d.trainDays ?? '?'} days a week, ${d.sessionMinutes ?? '?'} minutes a session; experience: ${d.experience ?? 'unknown'}; equipment: ${d.equipment ? EQUIPMENT[d.equipment as Equipment] ?? d.equipment : 'unknown (assume a full gym)'}
- Injuries / avoid: ${d.injuries || 'none given'}
- From their progress photos: ${c.lagging.length ? c.lagging.join(' | ') : 'no photo reads yet'}
- Recent lifts: ${c.performance || 'none logged yet'}
${c.current ? `\nCurrent plan (JSON):\n${JSON.stringify(c.current)}\n` : ''}
${c.instruction ? `What to do now: ${c.instruction}\n` : ''}
Rules (evidence-based):
- Choose the split that fits the days: 2–3 days full body; 4 upper/lower; 5 upper/lower + a weak-point day or PPL-hybrid; 6 push/pull/legs ×2. Exactly ${d.trainDays ?? 'the right number of'} training days in "days".
- Train every major muscle about twice a week, ~10–20 hard sets per muscle per week (beginners ~10–12, advanced up to 20). Lagging areas from the photos get the upper end and go early in a session.
- Compound lifts first (5–8 or 6–10 reps, rest 120–180 s), then isolation (8–15 reps, rest 60–90 s). Use real, specific exercise names (e.g. "Incline dumbbell press", "Cable lateral raise"), and keep the same names across revisions unless swapping on purpose.
- Fit each session in the time: about (rest + 40 s) per set plus 8 minutes of warm-up — usually 5–8 exercises. To add work for a priority, take sets from lower priorities rather than making the session longer.
- At least 2 sets per exercise (drop an exercise rather than leave it at 1 set), and no muscle under ~8 sets a week even when others are prioritised.
- Never list the same exercise twice in a day; if a swap would duplicate one, add a set to it or pick a different exercise.
- Only exercises their equipment allows; never anything their injuries rule out (give a safe alternative).
- On a cut, keep the heavy compounds and volume moderate — the goal is to keep muscle.
- When revising: change only what the reason calls for, and keep everything else identical.

Answer with: 1–4 short lines on ${c.current ? 'what you changed and why (or "No change needed" and why)' : 'why this split suits them'}, then exactly one block:
\`\`\`plan
{"name":"<split, N days>","why":"<one or two sentences>","days":[{"name":"<day name>","focus":"<muscles>","exercises":[{"name":"<exercise>","sets":3,"reps":"6-8","restSec":150,"note":"<optional cue>"}]}],"notes":["<optional: progression, deload, cardio>"]}
\`\`\``;
}

/* ---------------------------------------------------------------- progressive overload */

export type SetRow = { day: string; exercise: string; kg: number; reps: number };

/** "6-8" → [6, 8]; "10" → [10, 10]; "AMRAP" / "30 s" → null. */
export function repRange(reps: string): [number, number] | null {
  const m = /^(\d+)\s*(?:[-–to]+\s*(\d+))?\s*(reps?)?$/i.exec(reps.trim());
  if (!m) return null;
  const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
  return lo > 0 && hi >= lo ? [lo, hi] : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const sameExercise = (a: string, b: string) => norm(a) === norm(b);

/** How much to add once the top of the range is reached: more for big lower-body lifts, less for dumbbells. */
export function increment(name: string): number {
  const n = norm(name);
  if (/dumbbell|\bdb\b/.test(n)) return 2;
  if (/squat|deadlift|leg press|hip thrust|rdl|romanian|hack|lunge|split squat|calf/.test(n)) return 5;
  return 2.5;
}

/** Epley estimated one-rep max. */
export const e1rm = (kg: number, reps: number) => (kg > 0 ? Math.round(kg * (1 + reps / 30) * 10) / 10 : 0);

export type Next = { kg: number; reps: number; why: string };

/**
 * The aim for next time from the last session of this exercise: every working set at the top of the range
 * → add weight (back to the bottom of the range); otherwise the same weight, one more rep than the best set.
 */
export function nextTarget(ex: Pick<PlanExercise, 'name' | 'reps' | 'sets'>, history: SetRow[]): Next | null {
  const mine = history.filter((s) => sameExercise(s.exercise, ex.name));
  if (!mine.length) return null;
  const lastDay = mine.reduce((a, s) => (s.day > a ? s.day : a), '');
  const last = mine.filter((s) => s.day === lastDay);
  const kg = Math.max(...last.map((s) => s.kg));
  const working = last.filter((s) => s.kg === kg);
  const range = repRange(ex.reps);
  if (!range) return { kg, reps: Math.max(...working.map((s) => s.reps)), why: 'same as last time' };
  const [lo, hi] = range;
  if (working.length >= Math.min(ex.sets, 2) && working.every((s) => s.reps >= hi)) {
    if (kg === 0) return { kg, reps: hi + 2, why: `hit ${hi}+ on every set — add reps or a harder variation` };
    return { kg: kg + increment(ex.name), reps: lo, why: `hit ${hi} on every set at ${kg} kg — add weight` };
  }
  const best = Math.max(...working.map((s) => s.reps));
  if (best < lo) return { kg, reps: lo, why: `below ${lo} reps last time — same weight, aim for ${lo}` };
  return { kg, reps: Math.min(hi, best + 1), why: `same weight, one more rep (top of range is ${hi})` };
}

/** Per exercise, the last few sessions' best set, for the coach: "Bench press: 80×8 (Nov 3) → 82.5×7 (Nov 7)". */
export function performanceLines(history: SetRow[], sessions = 3): string {
  const byEx = new Map<string, SetRow[]>();
  for (const s of history) {
    const key = [...byEx.keys()].find((k) => sameExercise(k, s.exercise)) ?? s.exercise;
    byEx.set(key, [...(byEx.get(key) ?? []), s]);
  }
  const lines: string[] = [];
  for (const [ex, rows] of byEx) {
    const days = [...new Set(rows.map((r) => r.day))].sort().slice(-sessions);
    const tops = days.map((d) => {
      const best = rows.filter((r) => r.day === d).reduce((a, r) => (e1rm(r.kg, r.reps) > e1rm(a.kg, a.reps) || (r.kg === a.kg && r.reps > a.reps) ? r : a));
      return `${best.kg ? `${best.kg}×${best.reps}` : `${best.reps} reps`} (${d.slice(5)})`;
    });
    lines.push(`${ex}: ${tops.join(' → ')}`);
  }
  return lines.join('; ');
}

/** The plan in a few lines, for the coach's instructions. */
export function planLines(p: TrainingPlan): string {
  return `${p.name}. ` + p.days.map((d) => `${d.name}: ${d.exercises.map((e) => `${e.name} ${e.sets}×${e.reps}`).join(', ')}`).join(' | ');
}

/** The plan day to do next: the one after the day whose exercises were logged most recently. */
export function nextPlanDay(p: TrainingPlan, history: SetRow[]): number {
  const lastDay = history.reduce((a, s) => (s.day > a ? s.day : a), '');
  if (!lastDay) return 0;
  const done = new Set(history.filter((s) => s.day === lastDay).map((s) => norm(s.exercise)));
  let best = -1, score = 0;
  p.days.forEach((d, i) => {
    const n = d.exercises.filter((e) => done.has(norm(e.name))).length;
    if (n > score) { score = n; best = i; }
  });
  return best < 0 ? 0 : (best + 1) % p.days.length;
}

/**
 * True when a chat message asks to change the plan ("swap the back squat", "add more arm work", "drop
 * Bulgarian split squats") — so the plan is rewritten even when the model forgot to say so. A question
 * ("should I swap…?") is left to the coach.
 */
export function wantsPlanChange(text: string, p: TrainingPlan | null): boolean {
  const t = text.toLowerCase();
  if (!p || /\?\s*$/.test(t) || /^(should|can|could|would|is|are|do|does|what|why|how)\b/.test(t)) return false;
  if (!/\b(swap|replace|switch|substitute|change|add|remove|drop|take out|get rid of|instead of|no more|more|less|fewer|move)\b/.test(t)) return false;
  const words = new Set(p.days.flatMap((d) => [d.name, ...d.exercises.map((e) => e.name)]).join(' ').toLowerCase().match(/[a-z]{4,}/g) ?? []);
  return /\b(plan|split|workout|routine|program|exercise|session|sets?)\b/.test(t) || (t.match(/[a-z]{4,}/g) ?? []).some((w) => words.has(w));
}
