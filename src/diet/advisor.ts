// The numbers a good coach works from, computed here instead of left to a model's arithmetic:
// energy needs (Mifflin–St Jeor × activity), the weight trend from weigh-ins, what the log says the
// user really burns, how well they hit their targets, and when they'll reach their goal weight.

export const ACTIVITY = {
  sedentary: { factor: 1.2, label: 'Sedentary (desk job, little exercise)' },
  light: { factor: 1.375, label: 'Light (1–3 workouts a week)' },
  moderate: { factor: 1.55, label: 'Moderate (3–5 workouts a week)' },
  active: { factor: 1.725, label: 'Active (6–7 hard workouts a week)' },
  athlete: { factor: 1.9, label: 'Athlete (training twice a day / physical job)' },
} as const;
export type Activity = keyof typeof ACTIVITY;
export const isActivity = (a: unknown): a is Activity => typeof a === 'string' && a in ACTIVITY;

export type GoalKind = 'cut' | 'maintain' | 'bulk';
/** "cut", "lose fat", "lean bulk", "recomp"… as one of three directions. */
export function goalKind(goal: string | null | undefined): GoalKind {
  const g = (goal ?? '').toLowerCase();
  if (/cut|lose|loss|lean out|shred|fat|diet|slim|減量/.test(g)) return 'cut';
  if (/bulk|gain|mass|muscle|増量/.test(g)) return 'bulk';
  return 'maintain';
}

const KCAL_PER_KG = 7700; // energy in a kilogram of body fat, the usual working figure

export function bmr(sex: string | null | undefined, kg: number, cm: number, age: number): number {
  return 10 * kg + 6.25 * cm - 5 * age + (sex === 'female' ? -161 : 5);
}

export type Weigh = { day: string; kg: number };
export type DayLog = { day: string; kcal: number; protein: number };

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/** kg per week from a least-squares line through the weigh-ins of the last `days` days (null: too few). */
export function weeklyTrend(weights: Weigh[], today: string, days = 28): number | null {
  const pts = weights.filter((w) => dayNum(today) - dayNum(w.day) <= days);
  if (pts.length < 2) return null;
  const xs = pts.map((w) => dayNum(w.day)), ys = pts.map((w) => w.kg);
  if (Math.max(...xs) - Math.min(...xs) < 5) return null; // a few days of water swings say nothing yet
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return slope * 7;
}

export type Profile = {
  sex?: string | null; age?: number | null; heightCm?: number | null; goal?: string | null; activity?: string | null;
  goalWeightKg?: number | null; calories?: number | null; protein?: number | null; fat?: number | null; carbs?: number | null;
};

export type Advice = {
  weightKg: number | null;
  bmi: number | null;
  bmr: number | null;
  maintenance: number | null; // from the formula
  observedMaintenance: number | null; // from what they ate and how their weight moved
  trendKgPerWeek: number | null;
  goal: GoalKind;
  safeRateKgPerWeek: [number, number] | null; // a sensible pace for the goal
  suggested: { calories: number; protein: number; fat: number; carbs: number } | null;
  adherence: { daysLogged: number; avgKcal: number; avgProtein: number; daysOnTarget: number } | null;
  goalEta: { weeks: number; date: string } | null;
  targetsMismatch: Mismatch | null; // their macro targets come to a different calorie total
  missing: string[]; // what's needed for the rest
};

export type Mismatch = { macroKcal: number; calories: number; carbsForCalories: number };

/**
 * Protein and carbs are 4 kcal a gram, fat 9: when the macro targets add up to a different total than the
 * calorie target (by more than 5%, at least 75 kcal), hitting one means missing the other.
 */
export function targetsMismatch(t: { calories?: number | null; protein?: number | null; fat?: number | null; carbs?: number | null } | null): Mismatch | null {
  if (!t?.calories || t.protein == null || t.fat == null || t.carbs == null) return null;
  const macroKcal = Math.round(t.protein * 4 + t.fat * 9 + t.carbs * 4);
  if (Math.abs(macroKcal - t.calories) <= Math.max(75, t.calories * 0.05)) return null;
  return { macroKcal, calories: t.calories, carbsForCalories: Math.max(0, Math.round((t.calories - t.protein * 4 - t.fat * 9) / 4)) };
}

const r = Math.round;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function advise(p: Profile | null, weights: Weigh[], logs: DayLog[], today: string): Advice {
  const weightKg = weights.at(-1)?.kg ?? null;
  const cm = p?.heightCm ?? null, age = p?.age ?? null;
  const goal = goalKind(p?.goal);
  const missing = [
    !p?.sex && 'sex', !age && 'age', !cm && 'height', !weightKg && 'weight', !isActivity(p?.activity) && 'activity level', !p?.goal && 'goal',
  ].filter(Boolean) as string[];

  const bmi = weightKg && cm ? weightKg / (cm / 100) ** 2 : null;
  const base = weightKg && cm && age ? bmr(p?.sex, weightKg, cm, age) : null;
  const maintenance = base ? base * (isActivity(p?.activity) ? ACTIVITY[p!.activity as Activity].factor : 1.375) : null;
  const trend = weeklyTrend(weights, today);

  // what they really burn: average intake minus the energy their weight change stands for (needs 2 weeks of both)
  const recent = logs.filter((l) => dayNum(today) - dayNum(l.day) <= 28 && dayNum(l.day) < dayNum(today));
  const observedMaintenance = trend != null && recent.length >= 10
    ? recent.reduce((a, l) => a + l.kcal, 0) / recent.length - (trend * KCAL_PER_KG) / 7
    : null;

  let suggested: Advice['suggested'] = null;
  const burn = observedMaintenance ?? maintenance;
  if (burn && weightKg && cm) {
    // protein and fat by body weight — for a high BMI by the weight at BMI 25, so they aren't inflated by fat
    const refKg = bmi && bmi > 27 ? 25 * (cm / 100) ** 2 : weightKg;
    const floor = p?.sex === 'female' ? 1200 : 1500;
    const calories = goal === 'cut' ? Math.max(floor, base ?? 0, burn - Math.min(750, Math.max(300, weightKg * 0.0075 * KCAL_PER_KG / 7)))
      : goal === 'bulk' ? burn + 300 : burn;
    const protein = refKg * (goal === 'cut' ? 2.2 : 1.8);
    const fat = Math.max(refKg * 0.8, (calories * 0.2) / 9);
    const carbs = Math.max(0, (calories - protein * 4 - fat * 9) / 4);
    suggested = { calories: r(calories / 10) * 10, protein: r(protein), fat: r(fat), carbs: r(carbs) };
  }

  const safeRateKgPerWeek: Advice['safeRateKgPerWeek'] = weightKg
    ? goal === 'cut' ? [-r1(weightKg * 0.01), -r1(weightKg * 0.005)] : goal === 'bulk' ? [0.1, r1(Math.max(0.2, weightKg * 0.0035))] : [-0.1, 0.1]
    : null;

  const week = logs.filter((l) => dayNum(today) - dayNum(l.day) < 7);
  const adherence = week.length ? {
    daysLogged: week.length,
    avgKcal: r(week.reduce((a, l) => a + l.kcal, 0) / week.length),
    avgProtein: r(week.reduce((a, l) => a + l.protein, 0) / week.length),
    daysOnTarget: p?.calories ? week.filter((l) => Math.abs(l.kcal - p.calories!) <= p.calories! * 0.1).length : 0,
  } : null;

  let goalEta: Advice['goalEta'] = null;
  const target = p?.goalWeightKg;
  if (target && weightKg && trend && Math.sign(target - weightKg) === Math.sign(trend) && Math.abs(trend) >= 0.05) {
    const weeks = Math.abs(target - weightKg) / Math.abs(trend);
    if (weeks < 260) {
      const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + r(weeks * 7));
      goalEta = { weeks: r1(weeks), date: d.toISOString().slice(0, 10) };
    }
  }

  return {
    weightKg, bmi: bmi ? r1(bmi) : null, bmr: base ? r(base) : null, maintenance: maintenance ? r(maintenance) : null,
    observedMaintenance: observedMaintenance ? r(observedMaintenance) : null, trendKgPerWeek: trend == null ? null : Math.round(trend * 100) / 100,
    goal, safeRateKgPerWeek, suggested, adherence, goalEta, targetsMismatch: targetsMismatch(p), missing,
  };
}

/** The advice as lines for the coach's instructions. */
export function adviceLines(a: Advice, p: Profile | null): string {
  const lines = [
    a.bmr && `BMR ${a.bmr} kcal; maintenance ≈ ${a.maintenance} kcal (formula${isActivity(p?.activity) ? `, ${p!.activity}` : ', activity unknown — assumed light'})`,
    a.observedMaintenance && `maintenance from their own log and weight trend ≈ ${a.observedMaintenance} kcal (trust this over the formula)`,
    a.bmi && `BMI ${a.bmi}`,
    a.trendKgPerWeek != null ? `weight trend ${a.trendKgPerWeek > 0 ? '+' : ''}${a.trendKgPerWeek} kg/week (last 4 weeks)` : 'weight trend: not enough weigh-ins yet (needs 2+ over 5+ days)',
    a.safeRateKgPerWeek && `sensible pace for "${a.goal}": ${a.safeRateKgPerWeek[0]} to ${a.safeRateKgPerWeek[1]} kg/week`,
    a.suggested && `evidence-based targets for this goal: ${a.suggested.calories} kcal · P ${a.suggested.protein} · F ${a.suggested.fat} · C ${a.suggested.carbs}`,
    a.adherence && `last 7 days: ${a.adherence.daysLogged} days logged, avg ${a.adherence.avgKcal} kcal, avg protein ${a.adherence.avgProtein} g${p?.calories ? `, ${a.adherence.daysOnTarget} days within 10% of target` : ''}`,
    p?.goalWeightKg && `goal weight ${p.goalWeightKg} kg${a.goalEta ? ` — at the current trend in ~${a.goalEta.weeks} weeks (${a.goalEta.date})` : ''}`,
    a.targetsMismatch && `THEIR TARGETS DON'T ADD UP: P/F/C come to ${a.targetsMismatch.macroKcal} kcal but the calorie target is ${a.targetsMismatch.calories} — point this out once and offer a fix (carbs ${a.targetsMismatch.carbsForCalories} g keeps ${a.targetsMismatch.calories} kcal, or calories ${a.targetsMismatch.macroKcal} keeps the macros)`,
    a.missing.length && `unknown: ${a.missing.join(', ')}`,
  ];
  return lines.filter(Boolean).map((l) => `  - ${l}`).join('\n');
}
