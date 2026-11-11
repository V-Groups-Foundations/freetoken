import { describe, expect, it } from 'vitest';
import { actionSchema } from '@/diet/protocol';
import { findFood } from '@/diet/foods';
import { fitPortions, portionLine } from '@/diet/portion';

const targets = { calories: 2000, protein: 200, fat: 55, carbs: 220 };
const sum = (line: string) => Number(/= (\d+) kcal/.exec(line)?.[1]);

describe('"how much chicken and rice for dinner" — the app works out the grams', () => {
  it('sizes raw chicken and cooked rice to what is left, after the SAVAS latte they will have', () => {
    // 11-11: lunch etc. logged, 1108 kcal / P 119 / F 30 / C 134 left before dinner
    const eaten = [{ kcal: 892, protein: 81, fat: 25, carbs: 86 }];
    const savas = { name: 'SAVAS latte', kcal: 193, protein: 30, fat: 0, carbs: 13 };
    const line = portionLine({ meal: 'dinner', foods: ['chicken breast raw', 'white rice cooked'], keep: [savas], eaten, targets })!;
    expect(line).toMatch(/^\*\*For dinner, after SAVAS latte \(193 kcal\)/);
    expect(line).toMatch(/\d+ g chicken breast, raw \+ \d+ g white rice, cooked/);
    const kcal = sum(line);
    expect(kcal).toBeLessThanOrEqual(1108 - 193);
    expect(kcal).toBeGreaterThan(1108 - 193 - 120); // fills the day, not a token amount
    const grams = [...line.matchAll(/(\d+) g (chicken|white)/g)].map((m) => Number(m[1]));
    expect(grams.every((g) => g % 10 === 0)).toBe(true);
    expect(grams[0]).toBeGreaterThan(200); // ~89 g protein still needed: mostly from the chicken
  });

  it('whole eggs, never over the calories, and says so when there is nothing left', () => {
    const p = fitPortions({ kcal: 300, protein: 30, fat: 20, carbs: 0 }, [findFood('eggs')!]);
    expect(p[0].grams % 50).toBe(0);
    expect(p[0].grams * 1.42).toBeLessThanOrEqual(300);
    const none = portionLine({ meal: 'dinner', foods: ['chicken breast raw'], eaten: [{ kcal: 1990, protein: 190, fat: 50, carbs: 200 }], targets })!;
    expect(none).toContain('only 10 kcal left');
    expect(portionLine({ foods: ['pizza'], eaten: [], targets })).toBeNull();
    expect(portionLine({ foods: ['chicken breast raw'], eaten: [], targets: null })).toBeNull();
  });

  it('the coach can send a portion block', () => {
    const a = actionSchema.parse({ portion: { meal: 'dinner', foods: ['chicken breast raw', 'rice cooked'], keep: [{ meal: 'drink', name: 'SAVAS', kcal: 193, protein: 30 }] } });
    expect(a.portion?.foods).toHaveLength(2);
  });
});
