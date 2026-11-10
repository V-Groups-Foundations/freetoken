// Training plans and workout sets in the database, and writing a plan with the user's models.
import { and, desc, eq, gte } from 'drizzle-orm';
import type { DB } from '@/db';
import { trainingPlans, workoutSets } from '@/db/schema';
import { completeText } from '@/server/complete';
import { getProfile, listPhotos, listWeights, shiftDay } from './service';
import {
  EQUIPMENT, detailsMissing, nextPlanDay, planProblems, nextTarget, parsePlanReply, performanceLines, planLines, planPrompt, planSchema,
  type Equipment, type SetRow, type TrainingDetails, type TrainingPlan,
} from './training';

export async function currentPlan(db: DB, userId: string) {
  const [row] = await db.select().from(trainingPlans).where(eq(trainingPlans.userId, userId)).orderBy(desc(trainingPlans.id)).limit(1);
  if (!row) return null;
  const plan = planSchema.safeParse(row.plan);
  return plan.success ? { id: row.id, plan: plan.data, change: row.change, source: row.source, createdAt: row.createdAt } : null;
}

/** Earlier versions' notes (newest first): what changed each time. */
export async function planHistory(db: DB, userId: string, limit = 8) {
  return db.select({ id: trainingPlans.id, change: trainingPlans.change, source: trainingPlans.source, createdAt: trainingPlans.createdAt })
    .from(trainingPlans).where(eq(trainingPlans.userId, userId)).orderBy(desc(trainingPlans.id)).limit(limit);
}

export async function savePlan(db: DB, userId: string, plan: TrainingPlan, change: string, source: string) {
  const [row] = await db.insert(trainingPlans).values({ userId, plan, change, source }).returning({ id: trainingPlans.id });
  return row.id;
}

export async function listSets(db: DB, userId: string, sinceDay: string): Promise<(SetRow & { id: number })[]> {
  return db.select({ id: workoutSets.id, day: workoutSets.day, exercise: workoutSets.exercise, kg: workoutSets.kg, reps: workoutSets.reps })
    .from(workoutSets).where(and(eq(workoutSets.userId, userId), gte(workoutSets.day, sinceDay))).orderBy(workoutSets.day, workoutSets.id);
}

export async function logSets(db: DB, userId: string, day: string, sets: { exercise: string; kg: number; reps: number }[]) {
  if (!sets.length) return 0;
  await db.insert(workoutSets).values(sets.map((s) => ({ userId, day, exercise: s.exercise.trim().slice(0, 80), kg: Math.max(0, s.kg), reps: Math.round(s.reps) })));
  return sets.length;
}

export async function deleteSet(db: DB, userId: string, id: number) {
  const gone = await db.delete(workoutSets).where(and(eq(workoutSets.id, id), eq(workoutSets.userId, userId))).returning({ id: workoutSets.id });
  return gone.length > 0;
}

export function trainingDetails(p: Awaited<ReturnType<typeof getProfile>>): TrainingDetails {
  return {
    trainDays: p?.trainDays, sessionMinutes: p?.sessionMinutes, experience: p?.experience, equipment: p?.equipment, injuries: p?.injuries,
    sex: p?.sex, age: p?.age, heightCm: p?.heightCm, goal: p?.goal,
  };
}

export type PlanResult = { ok: true; id: number; plan: TrainingPlan; change: string } | { ok: false; status: number; message: string };

/**
 * Write (no plan yet) or revise the plan. `instruction` says why: the user's request, a new photo read, a
 * chat request. The model's JSON is checked; a broken answer gets one retry with the problem pointed out.
 */
export async function generatePlan(db: DB, userId: string, today: string, opts: { instruction?: string | null; source: string }): Promise<PlanResult> {
  const [profile, weights, photos, history, current] = await Promise.all([
    getProfile(db, userId), listWeights(db, userId, 30), listPhotos(db, userId, 6), listSets(db, userId, shiftDay(today, -42)), currentPlan(db, userId),
  ]);
  const details = trainingDetails(profile);
  const missing = detailsMissing(details);
  if (!current && missing.length) return { ok: false, status: 400, message: `Add your training details first: ${missing.join(', ')}.` };
  const prompt = planPrompt({
    details, weightKg: weights.at(-1)?.kg ?? null,
    lagging: photos.filter((p) => p.summary || p.analysis).slice(0, 3).map((p) => `${p.day} ${p.pose}: ${p.summary ?? p.analysis!.slice(0, 300)}`),
    current: current?.plan ?? null, instruction: opts.instruction ?? null, performance: performanceLines(history),
  });
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: prompt }];
  let fallback: { plan: TrainingPlan; change: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await completeText(userId, messages, { task: 'reasoning', temperature: 0.3, session: `training:${userId}` });
    if (!res.ok) { if (fallback) break; return res; }
    const parsed = parsePlanReply(res.text);
    // a plan that parses but breaks the rules (a duplicate, too long a session) gets sent back once or twice
    const problems = 'plan' in parsed ? planProblems(parsed.plan, details) : [];
    if ('plan' in parsed && problems.length && attempt < 2) {
      fallback = fallback ? { ...parsed, change: fallback.change } : parsed;
      messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: `Fix these and answer again in the same format: ${problems.join('; ')}.` });
      continue;
    }
    if ('plan' in parsed) {
      // the note says what the user asked for: a corrected retry describes only its fixes, so keep the first
      if (fallback?.change) parsed.change = fallback.change;
      // a review that changes nothing doesn't make a new version
      if (current && JSON.stringify(current.plan) === JSON.stringify(parsed.plan)) return { ok: true, id: current.id, plan: current.plan, change: parsed.change || 'No change needed.' };
      const id = await savePlan(db, userId, parsed.plan, parsed.change || (current ? 'Plan updated.' : parsed.plan.why), opts.source);
      return { ok: true, id, plan: parsed.plan, change: parsed.change };
    }
    messages.push({ role: 'assistant', content: res.text }, { role: 'user', content: `That can't be used: ${parsed.error}. Answer again with the short note and exactly one valid \`\`\`plan JSON block.` });
  }
  if (fallback) { // still imperfect after the retries: better a usable plan than none
    const id = await savePlan(db, userId, fallback.plan, fallback.change || 'Plan updated.', opts.source);
    return { ok: true, id, plan: fallback.plan, change: fallback.change };
  }
  return { ok: false, status: 502, message: 'The coach could not produce a valid plan — try again.' };
}

/** What the diet coach is told about training: details, the plan, today's targets, recent lifts. */
export async function trainingCoachLines(db: DB, userId: string, today: string): Promise<string> {
  const [profile, plan, history] = await Promise.all([getProfile(db, userId), currentPlan(db, userId), listSets(db, userId, shiftDay(today, -42))]);
  const d = trainingDetails(profile);
  const parts = [
    `${d.trainDays ?? '?'} days/week, ${d.sessionMinutes ?? '?'} min, ${d.experience ?? 'experience unknown'}, ${d.equipment ? EQUIPMENT[d.equipment as Equipment] ?? d.equipment : 'equipment unknown'}${d.injuries ? `, avoid: ${d.injuries}` : ''}`,
  ];
  if (plan) {
    parts.push(`plan: ${planLines(plan.plan)}`);
    const next = plan.plan.days[nextPlanDay(plan.plan, history)];
    const targets = next.exercises.map((e) => { const t = nextTarget(e, history); return t ? `${e.name} ${t.kg ? `${t.kg} kg × ` : ''}${t.reps}` : null; }).filter(Boolean);
    parts.push(`next session: ${next.name}${targets.length ? ` (aim: ${targets.join(', ')})` : ''}`);
  }
  const perf = performanceLines(history);
  if (perf) parts.push(`recent lifts: ${perf}`);
  return parts.join('\n  ');
}
