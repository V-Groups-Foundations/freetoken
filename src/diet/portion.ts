// "How much chicken and rice should I have for dinner?" — the model's own arithmetic got this wrong, so the
// coach only names the foods (and anything they'll have anyway, like a SAVAS latte) and the app works out the
// grams from what's really left today: protein and calories first, then carbs, fat last.
import { exactItem, findFood, type Food } from './foods';
import { sumTotals, type Totals } from './protocol';

type Targets = { calories?: number | null; protein?: number | null; fat?: number | null; carbs?: number | null } | null;
export type Portion = { food: Food; grams: number };

const rows = (f: Food) => [f.per100.kcal, f.per100.protein, f.per100.fat, f.per100.carbs];

/**
 * Grams of each food that best fill `left` (kcal, P, F, C) without going over the calories: a non-negative
 * least-squares fit (each nutrient scaled to its size and weighted: kcal and protein most, fat least).
 */
export function fitPortions(left: Totals, foods: Food[], have: { protein: boolean; fat: boolean; carbs: boolean } = { protein: true, fat: true, carbs: true }): Portion[] {
  const b = [left.kcal, left.protein, left.fat, left.carbs].map((v) => Math.max(0, v));
  const floor = [200, 15, 8, 20];
  const weight = [3, have.protein ? 3 : 0, have.fat ? 0.5 : 0, have.carbs ? 1 : 0];
  const w = b.map((v, i) => weight[i] / Math.max(v, floor[i]) ** 2);
  const A = foods.map(rows); // A[j][i]: nutrient i per 100 g of food j
  const x = foods.map(() => 0); // hundreds of grams
  for (let it = 0; it < 400; it++) {
    for (let j = 0; j < foods.length; j++) {
      let g = 0, h = 0;
      for (let i = 0; i < 4; i++) {
        const fit = foods.reduce((s, _, k) => s + A[k][i] * x[k], 0);
        g += w[i] * A[j][i] * (fit - b[i]);
        h += w[i] * A[j][i] ** 2;
      }
      if (h > 0) x[j] = Math.max(0, x[j] - g / h);
    }
  }
  // never over the calories left
  const kcal = foods.reduce((s, f, j) => s + f.per100.kcal * x[j], 0);
  if (kcal > b[0] && kcal > 0) for (let j = 0; j < x.length; j++) x[j] *= b[0] / kcal;
  return foods.map((food, j) => ({ food, grams: roundGrams(food, x[j] * 100) })).filter((p) => p.grams > 0);
}

/** Whole eggs and bananas, whole tablespoons of oil, otherwise to 10 g (rounded down when it would go over). */
function roundGrams(f: Food, g: number) {
  if (f.each) return Math.round(g / f.each) * f.each;
  if (f.tbsp && f.per100.kcal > 500) return Math.round(g / f.tbsp) * f.tbsp;
  return g < 10 ? 0 : Math.round(g / 10) * 10;
}

const amount = (p: Portion) => {
  if (p.food.each) { const n = Math.round(p.grams / p.food.each); return `${n} ${p.food.key === 'egg' ? (n === 1 ? 'egg' : 'eggs') : p.food.key === 'banana' ? (n === 1 ? 'banana' : 'bananas') : `× ${p.food.label}`}`; }
  if (p.food.tbsp && p.food.per100.kcal > 500) return `${p.grams / p.food.tbsp} tbsp ${p.food.label.split(' —')[0]}`;
  return `${p.grams} g ${p.food.label.replace(/, skinless/, '').split(' (')[0].split(' —')[0]}`;
};
const nut = (p: Portion) => rows(p.food).map((v) => (v * p.grams) / 100);
const g0 = (n: number) => Math.round(n);

/**
 * The line the app adds under a "how much should I eat" answer. `foods`: the names the coach gave (table
 * foods; "raw"/"cooked" decides which chicken). `keep`: what they'll have anyway, with its numbers.
 */
export function portionLine(opts: { meal?: string; foods: string[]; keep?: (Totals & { name: string })[]; eaten: Totals[]; targets: Targets }): string | null {
  const t = opts.targets;
  if (!t?.calories) return null;
  const foods = [...new Map(opts.foods.map((n) => findFood(n)).filter((f): f is Food => !!f).map((f) => [f.key, f])).values()];
  if (!foods.length) return null;
  const keep = (opts.keep ?? []).map((k) => exactItem(k));
  const eaten = sumTotals(opts.eaten);
  const kept = sumTotals(keep);
  const left: Totals = {
    kcal: t.calories - eaten.kcal - kept.kcal,
    protein: (t.protein ?? 0) - eaten.protein - kept.protein,
    fat: (t.fat ?? 0) - eaten.fat - kept.fat,
    carbs: (t.carbs ?? 0) - eaten.carbs - kept.carbs,
  };
  const meal = opts.meal?.trim() || 'this meal';
  const head = `**For ${meal}${keep.length ? `, after ${keep.map((k) => `${k.name} (${g0(k.kcal)} kcal)`).join(' and ')}` : ''} — worked out by the app:**`;
  if (left.kcal < 80) return `${head} only ${g0(Math.max(0, left.kcal))} kcal left today — not enough for a portion of ${foods.map((f) => f.label.split(',')[0]).join(' or ')}.`;
  const plan = fitPortions(left, foods, { protein: !!t.protein, fat: !!t.fat, carbs: !!t.carbs });
  if (!plan.length) return null;
  const tot = plan.map(nut).reduce((s, v) => s.map((x, i) => x + v[i]), [0, 0, 0, 0]);
  const rest = [left.kcal - tot[0], left.protein - tot[1], left.fat - tot[2], left.carbs - tot[3]];
  return `${head} ${plan.map(amount).join(' + ')} = ${g0(tot[0])} kcal · P ${g0(tot[1])} · F ${g0(tot[2])} · C ${g0(tot[3])} g`
    + `\n**That leaves:** ${g0(rest[0])} kcal · P ${g0(rest[1])} · F ${g0(rest[2])} · C ${g0(rest[3])} g for the rest of today`;
}
