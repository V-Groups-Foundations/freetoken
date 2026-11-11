import { describe, expect, it } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { exactItem, findFood, gramsIn } from '@/diet/foods';
import { todayLine, withoutModelTotals } from '@/diet/protocol';
import { applyDietActions, exactNumbers, listEntries, myFoods } from '@/diet/service';

const item = (name: string, kcal = 999, protein = 99, fat = 99, carbs = 99) => ({ meal: 'dinner' as const, name, kcal, protein, fat, carbs });

describe('exact numbers for everyday foods (the coach guessed them)', () => {
  it('raw chicken breast uses raw values, not cooked (220 g: 231 kcal, P 51 — it logged 363 / 68)', () => {
    const raw = exactItem(item('220g raw chicken breast', 363, 68, 8, 0));
    expect(raw).toMatchObject({ kcal: 231, protein: 51.3, fat: 4.2 });
    expect(exactItem(item('100 g raw chicken breast', 165, 31, 4, 0))).toMatchObject({ kcal: 105, protein: 23.3 });
    expect(exactItem(item('150g grilled chicken breast'))).toMatchObject({ kcal: 248, protein: 46.5 });
    // raw or cooked not said: left as the model gave it
    expect(exactItem(item('200g chicken breast', 300, 50, 5, 0)).kcal).toBe(300);
  });

  it('eggs are the same per egg every time; rice and yogurt by grams or tablespoons', () => {
    const two = exactItem(item('2 boiled eggs (~100g)', 140, 12, 10, 1));
    const three = exactItem(item('3 boiled eggs', 234, 19, 16, 2));
    expect(two.kcal).toBe(142);
    expect(three.kcal).toBe(213);
    expect(three.kcal / 3).toBeCloseTo(two.kcal / 2, 0);
    expect(exactItem(item('220 g cooked rice', 286, 7, 0, 62))).toMatchObject({ kcal: 343, protein: 5.5, carbs: 81.6 });
    expect(exactItem(item('Meiji plain yogurt 4 tbsp'))).toMatchObject({ kcal: 34 });
    expect(exactItem(item('1 natto pack'))).toMatchObject({ kcal: 86 });
  });

  it("mixed dishes and things that aren't the plain food stay as the model gave them", () => {
    for (const n of ['egg fried rice 300g', 'chicken breast and rice 400g', 'rice cake 2 pieces', 'SAVAS milk protein latte 430ml', 'omelette 2 eggs', '200g brown rice'])
      expect(exactItem(item(n)).kcal).toBe(999);
    expect(findFood('egg whites 100g')?.key).toBe('egg-white');
    expect(gramsIn('3 large eggs', findFood('3 large eggs')!)).toBe(150);
  });

  it('their own foods: the same food logged again gets the numbers it had (the SAVAS latte was re-guessed)', async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    await applyDietActions(db, u.id, '2026-11-10', [{ log: [item('SAVAS Milk Protein 30g Caffe Latte 430ml', 193, 30, 0, 13)] }], 'had my savas');
    const known = await myFoods(db, u.id);
    expect(known[0]).toMatchObject({ name: 'SAVAS Milk Protein 30g Caffe Latte 430ml', kcal: 193 });
    const again = exactNumbers(item('savas milk protein 30g caffe latte 430 ml', 200, 30, 5, 20), known);
    expect(again).toMatchObject({ kcal: 193, fat: 0, carbs: 13 });
    // logged through the coach: the stored numbers are the exact ones
    await applyDietActions(db, u.id, '2026-11-11', [{ log: [item('220g raw chicken breast', 363, 68, 8, 0)] }], 'chicken done');
    expect((await listEntries(db, u.id, '2026-11-11'))[0]).toMatchObject({ kcal: 231 });
  });
});

describe("the day's line comes from the log, not the model's arithmetic", () => {
  it('says eaten, left (or over) and each macro against its target', () => {
    const e = [{ kcal: 692, protein: 50.5, fat: 19.8, carbs: 66.3 }, { kcal: 200, protein: 30, fat: 5, carbs: 20 }];
    expect(todayLine(e, { calories: 2000, protein: 200, fat: 55, carbs: 220 })).toBe('**Today:** 892 of 2000 kcal — **1108 kcal left** · P 81/200 · F 25/55 · C 86/220 g');
    expect(todayLine([{ kcal: 2100, protein: 1, fat: 1, carbs: 1 }], { calories: 2000 })).toContain('**100 kcal over**');
  });

  it("takes the model's own totals out of the reply (what it said on 11-11), keeps what was logged", () => {
    const said = 'Lunch adds 692 kcal (P 50.5 g F 19.8 g C 66.3 g).\n\nNew daily total ≈ 2 064 kcal (P 225 g F 53.3 g C 178 g) – ≈ +64 kcal over target and +25 g protein above goal.';
    expect(withoutModelTotals(said)).toBe('Lunch adds 692 kcal (P 50.5 g F 19.8 g C 66.3 g).');
    const inline = 'Added 1 Tbsp Meiji plain yogurt: ~9 kcal (P 0.5 g F 0.5 g C 1 g). New total ≈ 2 001 kcal (P 196.5 g). Left today ≈ ‑2 kcal (P 3.5 g).';
    expect(withoutModelTotals(inline)).toBe('Added 1 Tbsp Meiji plain yogurt: ~9 kcal (P 0.5 g F 0.5 g C 1 g).');
    expect(withoutModelTotals('Good choice — more protein at dinner helps recovery.')).toBe('Good choice — more protein at dinner helps recovery.');
  });
});
