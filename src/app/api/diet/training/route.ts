import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { getProfile, shiftDay } from '@/diet/service';
import { currentPlan, listSets, planHistory, trainingDetails } from '@/diet/plan';
import { detailsMissing, e1rm, nextPlanDay, nextTarget, sameExercise } from '@/diet/training';
import { dayParam } from '@/diet/day';

/** The Training tab: details, the current plan with next targets, its history, and recent workouts. */
export async function GET(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const db = getDb();
  const today = dayParam(new URL(req.url).searchParams.get('today'));
  const [profile, plan, history, sets] = await Promise.all([
    getProfile(db, uid), currentPlan(db, uid), planHistory(db, uid), listSets(db, uid, shiftDay(today, -120)),
  ]);
  const details = trainingDetails(profile);
  const next = plan ? plan.plan.days.map((d) => d.exercises.map((e) => nextTarget(e, sets))) : [];
  // per exercise: each session's best set and estimated 1RM, oldest first
  const progress: Record<string, { day: string; kg: number; reps: number; e1rm: number }[]> = {};
  for (const s of sets) {
    const key = Object.keys(progress).find((k) => sameExercise(k, s.exercise)) ?? s.exercise;
    const list = (progress[key] ??= []);
    const est = e1rm(s.kg, s.reps);
    const at = list.find((x) => x.day === s.day);
    if (!at) list.push({ day: s.day, kg: s.kg, reps: s.reps, e1rm: est });
    else if (est > at.e1rm || (s.kg === at.kg && s.reps > at.reps)) Object.assign(at, { kg: s.kg, reps: s.reps, e1rm: est });
  }
  return Response.json({
    details: { trainDays: details.trainDays ?? null, sessionMinutes: details.sessionMinutes ?? null, experience: details.experience ?? null, equipment: details.equipment ?? null, injuries: details.injuries ?? null },
    missing: detailsMissing(details),
    plan: plan ? { ...plan, next, nextDay: nextPlanDay(plan.plan, sets) } : null,
    history,
    today: sets.filter((s) => s.day === today),
    progress,
  });
}
