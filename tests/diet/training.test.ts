import { describe, expect, it } from 'vitest';
import {
  dayMinutes, detailsMissing, e1rm, increment, planProblems, wantsPlanChange, nextPlanDay, nextTarget, parsePlanReply, performanceLines, planLines, planPrompt, repRange, type TrainingPlan,
} from '@/diet/training';
import { currentPlan, deleteSet, listSets, logSets, planHistory, savePlan, trainingCoachLines } from '@/diet/plan';
import { applyDietActions, updateProfile } from '@/diet/service';
import { parseDietBlocks } from '@/diet/protocol';
import { createTestDb, createUser } from '../helpers/db';

const plan: TrainingPlan = {
  name: 'Upper/Lower, 4 days', why: 'Each muscle twice a week.', notes: [],
  days: [
    { name: 'Upper A', focus: 'chest, back', exercises: [{ name: 'Bench press', sets: 3, reps: '6-8', restSec: 150 }, { name: 'Cable lateral raise', sets: 3, reps: '12-15', restSec: 60 }] },
    { name: 'Lower A', focus: 'quads', exercises: [{ name: 'Back squat', sets: 3, reps: '5-8', restSec: 180 }] },
  ],
};

describe('training plan format', () => {
  it('reads the note and the plan; a broken plan says why', () => {
    const ok = parsePlanReply(`Added cable lateral raises for your side delts.\n\n\`\`\`plan\n${JSON.stringify(plan)}\n\`\`\``);
    expect(ok).toMatchObject({ change: 'Added cable lateral raises for your side delts.', plan: { name: 'Upper/Lower, 4 days' } });
    expect(parsePlanReply('no block here')).toEqual({ error: 'no ```plan block' });
    expect('error' in parsePlanReply('```plan\n{"name":"x","days":[]}\n```')).toBe(true);
    expect('error' in parsePlanReply('```plan\n{oops\n```')).toBe(true);
  });
  it('the prompt carries the schedule, injuries, photo reads and the current plan when revising', () => {
    const p = planPrompt({ details: { trainDays: 4, sessionMinutes: 60, experience: 'intermediate', equipment: 'gym', injuries: 'left shoulder', goal: 'cut' }, weightKg: 94,
      lagging: ['2026-11-10 front: lagging side delts and upper chest'], current: plan, instruction: 'more arms', performance: 'Bench press: 80×8 (11-08)' });
    for (const s of ['4 days a week, 60 minutes', 'left shoulder', 'lagging side delts', 'Revise', '"Bench press"', 'more arms', 'Exactly 4 training days']) expect(p).toContain(s);
    expect(detailsMissing({ trainDays: 4 })).toEqual(['minutes per session', 'experience', 'equipment']);
  });
});

describe('plan checks', () => {
  it('finds duplicates, the wrong number of days and sessions longer than they have', () => {
    expect(dayMinutes(plan.days[0])).toBe(Math.round(8 + (3 * 190 + 3 * 100) / 60));
    expect(planProblems(plan, { trainDays: 2, sessionMinutes: 60 })).toEqual([]);
    const dup = { ...plan, days: [{ ...plan.days[1], exercises: [...plan.days[1].exercises, { name: 'Back Squat', sets: 2, reps: '8', restSec: 120 }] }, plan.days[0]] };
    expect(planProblems(dup, { trainDays: 2 })).toEqual(['"Back Squat" appears twice in Lower A']);
    const long = { ...plan, days: [{ ...plan.days[0], exercises: Array.from({ length: 11 }, (_, i) => ({ name: `Exercise ${i}`, sets: 3, reps: '8-12', restSec: 120 })) }] };
    const problems = planProblems(long, { trainDays: 4, sessionMinutes: 75 });
    expect(problems[0]).toBe('it has 1 days but they train 4 days a week');
    expect(problems[1]).toMatch(/Upper A takes about 96 minutes \(11 exercises, 33 sets\) but they have 75/);
  });
});

describe('a plan change asked for in the chat', () => {
  it('is recognised even when the coach forgets to record it; questions and other talk are not', () => {
    for (const t of ['Swap the barbell back squat for something easier on my knees', 'add more arm work to my plan', 'Drop the cable lateral raise', 'replace bench press with dumbbell press'])
      expect(wantsPlanChange(t, plan), t).toBe(true);
    for (const t of ['Should I swap squats for leg press?', 'I had more rice for lunch', 'bench 80 kg 3x8', 'swap the rice for oats tomorrow'])
      expect(wantsPlanChange(t, plan), t).toBe(false);
    expect(wantsPlanChange('swap the back squat', null)).toBe(false);
  });
});

describe('progressive overload', () => {
  const at = (day: string, exercise: string, kg: number, reps: number[]) => reps.map((r) => ({ day, exercise, kg, reps: r }));
  it('rep ranges, increments and estimated 1RM', () => {
    expect(repRange('6-8')).toEqual([6, 8]);
    expect(repRange('10')).toEqual([10, 10]);
    expect(repRange('AMRAP')).toBeNull();
    expect(increment('Back squat')).toBe(5);
    expect(increment('Incline dumbbell press')).toBe(2);
    expect(increment('Bench press')).toBe(2.5);
    expect(e1rm(100, 5)).toBeCloseTo(116.7, 1);
  });
  it('top of the range on every set → more weight; otherwise one more rep at the same weight', () => {
    const bench = plan.days[0].exercises[0];
    expect(nextTarget(bench, at('2026-11-08', 'Bench press', 80, [8, 8, 8]))).toMatchObject({ kg: 82.5, reps: 6 });
    expect(nextTarget(bench, at('2026-11-08', 'bench press', 80, [8, 7, 6]))).toMatchObject({ kg: 80, reps: 8 });
    expect(nextTarget(bench, at('2026-11-08', 'Bench press', 80, [5, 4, 4]))).toMatchObject({ kg: 80, reps: 6 });
    // only the latest session counts
    expect(nextTarget(bench, [...at('2026-11-01', 'Bench press', 75, [8, 8, 8]), ...at('2026-11-08', 'Bench press', 77.5, [7, 6, 6])])).toMatchObject({ kg: 77.5, reps: 8 });
    expect(nextTarget(bench, [])).toBeNull();
  });
  it('knows which plan day is next and summarises lifts for the coach', () => {
    const h = [...at('2026-11-08', 'Bench press', 80, [8, 8]), ...at('2026-11-05', 'Back squat', 100, [6])];
    expect(nextPlanDay(plan, h)).toBe(1); // Upper A was last → Lower A
    expect(nextPlanDay(plan, [])).toBe(0);
    expect(performanceLines(h)).toBe('Bench press: 80×8 (11-08); Back squat: 100×6 (11-05)');
    expect(planLines(plan)).toContain('Upper A: Bench press 3×6-8');
  });
});

describe('plans, sets and the coach', () => {
  it('saves plan versions, logs sets, and the coach sees the plan and the next targets', async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    await updateProfile(db, u.id, { trainDays: 4, sessionMinutes: 60, experience: 'intermediate', equipment: 'gym' });
    await savePlan(db, u.id, plan, 'First plan.', 'new');
    await savePlan(db, u.id, { ...plan, name: 'Upper/Lower v2' }, 'Added arm work.', 'request');
    expect((await currentPlan(db, u.id))?.plan.name).toBe('Upper/Lower v2');
    expect((await planHistory(db, u.id)).map((h) => h.change)).toEqual(['Added arm work.', 'First plan.']);

    await logSets(db, u.id, '2026-11-08', [{ exercise: 'Bench press', kg: 80, reps: 8 }, { exercise: 'Bench press', kg: 80, reps: 8 }, { exercise: 'Bench press', kg: 80, reps: 8 }]);
    const sets = await listSets(db, u.id, '2026-11-01');
    expect(sets).toHaveLength(3);
    const lines = await trainingCoachLines(db, u.id, '2026-11-10');
    expect(lines).toContain('4 days/week, 60 min, intermediate');
    expect(lines).toContain('next session: Lower A');
    expect(lines).toContain('Bench press: 80×8 (11-08)');
    expect(await deleteSet(db, u.id, sets[0].id)).toBe(true);
  });

  it('the chat logs workouts once (a re-sent block adds nothing) and passes a plan change on', async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    const [a] = parseDietBlocks('Nice session.\n\n```diet\n{"workout":[{"exercise":"Bench press","kg":82.5,"reps":6,"sets":3}],"replan":"add a second arm day"}\n```');
    const applied = await applyDietActions(db, u.id, '2026-11-10', [a], 'bench 82.5 3x6');
    expect(applied.workout).toHaveLength(1);
    expect(applied.replan).toBe('add a second arm day');
    expect(await listSets(db, u.id, '2026-11-10')).toHaveLength(3);
    await applyDietActions(db, u.id, '2026-11-10', [a], 'thanks');
    expect(await listSets(db, u.id, '2026-11-10')).toHaveLength(3);
  });
});
