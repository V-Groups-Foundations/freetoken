import { describe, expect, it } from 'vitest';
import { advise, adviceLines, bmr, goalKind, weeklyTrend } from '@/diet/advisor';
import { parsePhysique, physiquePrompt } from '@/diet/physique';
import { coachSystemPrompt } from '@/diet/protocol';
import { addPhoto, coachState, deletePhoto, dietState, listPhotos, readPhoto, saveAnalysis, shiftDay, updateProfile, setWeight } from '@/diet/service';
import { createTestDb, createUser } from '../helpers/db';

const today = '2026-11-10';
const me = { sex: 'male', age: 23, heightCm: 186, goal: 'cut', activity: 'moderate', goalWeightKg: 85 };
// 95 → 93.5 kg over 3 weeks: −0.5 kg/week
const weights = [0, 7, 14, 21].map((d, i) => ({ day: shiftDay(today, d - 21), kg: 95 - i * 0.5 }));
const logs = Array.from({ length: 21 }, (_, i) => ({ day: shiftDay(today, -21 + i), kcal: 2300, protein: 170 }));

describe('advisor numbers', () => {
  it('Mifflin–St Jeor BMR and the goal direction from free text', () => {
    expect(bmr('male', 95, 186, 23)).toBeCloseTo(10 * 95 + 6.25 * 186 - 5 * 23 + 5);
    expect(bmr('female', 60, 165, 30)).toBeCloseTo(600 + 1031.25 - 150 - 161);
    expect(goalKind('cut to visible abs')).toBe('cut');
    expect(goalKind('lean bulk')).toBe('bulk');
    expect(goalKind('recomp')).toBe('maintain');
  });

  it('weekly trend is a line through the weigh-ins, and needs a real span of days', () => {
    expect(weeklyTrend(weights, today)).toBeCloseTo(-0.5, 2);
    expect(weeklyTrend([{ day: today, kg: 90 }], today)).toBeNull();
    expect(weeklyTrend([{ day: shiftDay(today, -2), kg: 91 }, { day: today, kg: 90 }], today)).toBeNull();
  });

  it('works out maintenance, what they really burn, sensible targets, adherence and when they reach the goal', () => {
    const a = advise({ ...me, calories: 2300 }, weights, logs, today);
    expect(a.maintenance).toBe(Math.round(bmr('male', 93.5, 186, 23) * 1.55));
    // 2300 eaten while losing 0.5 kg/week → burning ≈ 2300 + 0.5×7700/7 = 2850
    expect(a.observedMaintenance).toBeGreaterThan(2800);
    expect(a.observedMaintenance).toBeLessThan(2900);
    expect(a.trendKgPerWeek).toBeCloseTo(-0.5, 2);
    expect(a.goal).toBe('cut');
    expect(a.safeRateKgPerWeek).toEqual([-0.9, -0.5]);
    // a cut below what they burn, protein high, macros adding up to the calories
    const s = a.suggested!;
    expect(s.calories).toBeLessThan(a.observedMaintenance!);
    expect(s.calories).toBeGreaterThanOrEqual(2000);
    expect(s.protein).toBeGreaterThan(150);
    expect(Math.abs(s.protein * 4 + s.fat * 9 + s.carbs * 4 - s.calories)).toBeLessThan(30);
    expect(a.adherence).toMatchObject({ daysLogged: 6, avgKcal: 2300, daysOnTarget: 6 });
    // 8.5 kg to go at 0.5 kg/week ≈ 17 weeks
    expect(a.goalEta?.weeks).toBeCloseTo(17, 0);
    expect(a.missing).toEqual([]);
    const lines = adviceLines(a, me);
    expect(lines).toMatch(/maintenance from their own log/);
    expect(lines).toMatch(/goal weight 85 kg — at the current trend/);
  });

  it('says what is missing instead of guessing, and never suggests starving', () => {
    const a = advise(null, [], [], today);
    expect(a.suggested).toBeNull();
    expect(a.missing).toEqual(['sex', 'age', 'height', 'weight', 'activity level', 'goal']);
    const small = advise({ sex: 'female', age: 40, heightCm: 150, goal: 'cut', activity: 'sedentary' }, [{ day: today, kg: 48 }], [], today);
    expect(small.suggested!.calories).toBeGreaterThanOrEqual(1200);
  });

  it('no goal date when the trend goes the wrong way', () => {
    const up = [{ day: shiftDay(today, -14), kg: 93 }, { day: today, kg: 94 }];
    expect(advise(me, up, [], today).goalEta).toBeNull();
  });
});

describe('physique reads', () => {
  it('takes the write-up and the numbers apart; a bad block keeps the words', () => {
    const r = parsePhysique('**Body fat:** about 20–23%.\n\n```physique\n{"bodyFatLow": 23, "bodyFatHigh": 20, "summary": "~21%, good shoulders, soft midsection"}\n```');
    expect(r).toEqual({ text: '**Body fat:** about 20–23%.', bodyFatLow: 20, bodyFatHigh: 23, summary: '~21%, good shoulders, soft midsection' });
    expect(parsePhysique('Too blurry to judge.\n```physique\n{oops\n```')).toEqual({ text: 'Too blurry to judge.', bodyFatLow: null, bodyFatHigh: null, summary: null });
  });
  it('asks to compare with the first photo when there is one', () => {
    const p = physiquePrompt({ pose: 'front', about: 'male, 23 y', weightKg: 93, advice: null, previous: { day: '2026-10-01', bodyFat: '22–24', summary: 'soft midsection' }, comparing: true });
    expect(p).toMatch(/SECOND is that first photo/);
    expect(p).toMatch(/Change since the first photo/);
    expect(physiquePrompt({ pose: 'side', about: '', weightKg: null, advice: null, previous: null, comparing: false })).toMatch(/first photo of this pose/);
  });
});

describe('progress photos and the coach', () => {
  it('stores photos privately, remembers their reads, and the coach is told about them', async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    const other = await createUser(db);
    await updateProfile(db, u.id, { ...me, calories: 2300, protein: 190, fat: 70, carbs: 230 });
    for (const w of weights) await setWeight(db, u.id, w.day, w.kg);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(200).fill(1)]);
    const id = await addPhoto(db, u.id, { day: today, pose: 'front', data: jpeg, kg: 93.5 });
    await saveAnalysis(db, u.id, id, { text: 'Solid shoulders.', bodyFatLow: 19, bodyFatHigh: 22, summary: '~20%, strong shoulders, lagging abs' });

    expect(await readPhoto(db, u.id, id)).toEqual(jpeg);
    expect(await readPhoto(db, other.id, id)).toBeNull();
    const [listed] = await listPhotos(db, u.id);
    expect(listed).toMatchObject({ id, pose: 'front', kg: 93.5, bodyFatLow: 19, summary: '~20%, strong shoulders, lagging abs' });
    expect(listed).not.toHaveProperty('data');

    const state = await dietState(db, u.id, today);
    expect(state.advice.trendKgPerWeek).toBeCloseTo(-0.5, 2);
    expect(state.photos).toHaveLength(1);
    const prompt = coachSystemPrompt(await coachState(db, u.id, today));
    expect(prompt).toMatch(/front ~19–22% body fat: ~20%, strong shoulders, lagging abs/);
    expect(prompt).toMatch(/weight trend -0\.5 kg\/week/);
    expect(prompt).toMatch(/activity: moderate/);

    await updateProfile(db, u.id, { photoId: id });
    expect(await deletePhoto(db, other.id, id)).toBe(false);
    expect(await deletePhoto(db, u.id, id)).toBe(true);
    expect((await dietState(db, u.id, today)).profile?.photoId).toBeNull();
  });
});

describe('a question is not a meal', () => {
  it('tells asking for a suggestion from reporting food', async () => {
    const { onlyAsking } = await import('@/diet/protocol');
    for (const q of ["What should I eat for dinner tonight? I'm in Japan, near a konbini.", 'Plan the rest of my day to hit my targets', 'Are my current targets right for my cut?', '夕食は何を食べればいい？'])
      expect(onlyAsking(q), q).toBe(true);
    for (const said of ['Breakfast: 30 g SAVAS whey with water', 'I had a gyudon for lunch, what is left?', 'just ate 2 onigiri', 'ate a salad?', '牛丼を食べた'])
      expect(onlyAsking(said), said).toBe(false);
  });
});
