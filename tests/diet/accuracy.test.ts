import { describe, expect, it } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { createMemoryKV } from '@/lib/kv';
import { exactItem } from '@/diet/foods';
import { coachSystemPrompt, todayLine } from '@/diet/protocol';
import { applyDietActions, balanceMacros, coachState, listEntries } from '@/diet/service';
import { menuFacts, venueIn } from '@/diet/eating-out';

const it_ = (name: string, kcal: number, protein: number, fat: number, carbs: number, day?: string) => ({ meal: 'lunch' as const, name, kcal, protein, fat, carbs, ...(day ? { day } : {}) });
const adds = (i: { kcal: number; protein: number; fat: number; carbs: number }) => Math.abs(4 * i.protein + 4 * i.carbs + 9 * i.fat - i.kcal) <= Math.max(15, i.kcal * 0.15);

describe('every item adds up: P×4 + C×4 + F×9 ≈ kcal (what was logged at Hama Sushi on 11-12)', () => {
  it('fish without rice gets its fat, sushi gets its rice carbs; kcal and protein stay as given', () => {
    const salmon = balanceMacros(it_('salmon nigiri (no rice) 4 plates', 192, 20, 0, 0));
    expect(salmon.fixed).toBe(true);
    expect(salmon.item).toMatchObject({ kcal: 192, protein: 20, fat: 12.4, carbs: 0 });
    const tuna = balanceMacros(it_('tuna nigiri 3 pcs', 249, 18.6, 0.9, 24)).item;
    expect(tuna).toMatchObject({ kcal: 249, protein: 18.6, fat: 0.9, carbs: 41.6 });
    for (const x of [salmon.item, tuna, balanceMacros(it_('Tuna Kimchi Gunkan 2-piece plat x3', 258, 18, 3, 24)).item]) expect(adds(x)).toBe(true);
  });

  it('close enough is left alone (a label within ~15%); impossible numbers are fixed the right way round', () => {
    expect(balanceMacros(it_('SAVAS Milk Protein latte 430ml', 193, 30, 0, 13)).fixed).toBe(false);
    expect(balanceMacros(it_('restaurant meal', 1050, 65, 52, 85)).fixed).toBe(false);
    // more protein than the calories allow: the kcal is wrong
    expect(balanceMacros(it_('chicken salad', 100, 40, 5, 5)).item.kcal).toBe(225);
    // macros worth far more than the calories: fat and carbs shrink, protein stays
    const over = balanceMacros(it_('pasta bowl', 400, 20, 30, 80)).item;
    expect(over.protein).toBe(20);
    expect(adds(over)).toBe(true);
  });

  it('logged through the coach, the stored numbers add up and the reply says what was adjusted', async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    const balanced: string[] = [];
    await applyDietActions(db, u.id, '2026-11-12', [{ log: [it_('salmon nigiri (no rice) 1 plate', 48, 5, 0, 0)] }], '1 plate of salmon nigiri without rice', balanced);
    expect((await listEntries(db, u.id, '2026-11-12'))[0]).toMatchObject({ kcal: 48, protein: 5, fat: 3.1 });
    expect(balanced).toEqual(['salmon nigiri (no rice) 1 plate']);
  });
});

describe("the same food isn't logged twice (yesterday's meal came back with 'also add 400 kcal')", () => {
  it('a re-sent item with the same numbers under another name is skipped; a second SAVAS they mention is logged', async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    const y = '2026-11-11';
    await applyDietActions(db, u.id, '2026-11-12', [{ log: [it_('estimated meal', 1050, 65, 52, 85, y)] }], 'i would like you to add these values to yesterdays meals');
    await applyDietActions(db, u.id, '2026-11-12', [{ log: [it_('restaurant meal', 1050, 65, 52, 85, y), it_('extra calories', 400, 12, 12, 60, y)] }],
      'also add an extra 400 kcal and 12 g protein and 60 g carbs for yesterday as well');
    expect((await listEntries(db, u.id, y)).map((e) => e.name)).toEqual(['estimated meal', 'extra calories']);
    await applyDietActions(db, u.id, '2026-11-12', [{ log: [it_('SAVAS Milk Protein latte', 193, 30, 0, 13)] }], '1 savas latte');
    await applyDietActions(db, u.id, '2026-11-12', [{ log: [it_('SAVAS Milk Protein latte', 193, 30, 0, 13)] }], '30g protein savas coffee latte done');
    expect(await listEntries(db, u.id, '2026-11-12')).toHaveLength(2);
  });

  it("the coach sees yesterday's log, and a line for the day it logged to", async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    await applyDietActions(db, u.id, '2026-11-12', [{ log: [it_('estimated meal', 1050, 65, 52, 85, '2026-11-11')] }], 'add it to yesterday');
    const prompt = coachSystemPrompt(await coachState(db, u.id, '2026-11-12'));
    expect(prompt).toContain('Yesterday (2026-11-11) logged: lunch: estimated meal 1050 kcal P65');
    expect(todayLine([{ kcal: 1050, protein: 65, fat: 52, carbs: 85 }], { calories: 2000 }, 'Yesterday (Wed 11-11)')).toMatch(/^\*\*Yesterday \(Wed 11-11\):\*\* 1050 of 2000 kcal/);
  });
});

describe('eating out: the menu comes from the web, not a guess', () => {
  it('knows where they are eating', () => {
    expect(venueIn('i am going to hama sushi for lunch today what should i eat')).toMatch(/Hama Sushi/);
    expect(venueIn('im in japan hama sushi')).toMatch(/Hama Sushi/);
    expect(venueIn('Going to Ichiran tonight')).toMatch(/Ichiran/);
    expect(venueIn('going to Torikizoku with friends')).toBe('Torikizoku');
    expect(venueIn('going to the gym after work')).toBeNull();
    expect(venueIn('3 tuna nigiri')).toBeNull();
  });

  it('searches once, keeps it for the follow-ups of the meal, and says when it could not search', async () => {
    const kv = createMemoryKV();
    const asked: string[] = [];
    const search = async (q: string) => { asked.push(q); return { answer: 'Tuna nigiri 83 kcal, salmon nigiri 97 kcal per plate.', hits: [{ title: 'はま寿司 栄養成分', url: 'https://www.hama-sushi.co.jp/menu/', snippet: 'まぐろ 83kcal サーモン 97kcal' }] }; };
    const first = await menuFacts(kv, 'u1', 'going to hama sushi for lunch', search, 1000);
    expect(first).toMatchObject({ venue: expect.stringMatching(/Hama Sushi/), fresh: true });
    expect(first && 'facts' in first && first.facts).toContain('まぐろ 83kcal');
    const later = await menuFacts(kv, 'u1', 'okay 4 tuna nigiri', search, 1000 + 60 * 60 * 1000);
    expect(later).toMatchObject({ fresh: false });
    expect(asked).toHaveLength(1);
    expect(await menuFacts(kv, 'u1', 'okay 4 tuna nigiri', search, 1000 + 4 * 60 * 60 * 1000)).toBeNull();
    expect(await menuFacts(kv, 'u2', 'going to sushiro', null)).toMatchObject({ facts: null, why: expect.stringMatching(/Tavily/) });
    const prompt = coachSystemPrompt({ today: '2026-11-12', profile: null, entries: [], week: [], weights: [], menu: first! } as never);
    expect(prompt).toContain('use THESE numbers from the web');
  });
});

describe('sushi toppings in the food table', () => {
  it('tuna and farmed salmon sashimi by grams; nigiri and other salmon stay as given', () => {
    expect(exactItem(it_('100 g tuna sashimi', 1, 1, 1, 1))).toMatchObject({ kcal: 115, protein: 26.4 });
    expect(exactItem(it_('salmon sashimi 100g', 1, 1, 1, 1))).toMatchObject({ kcal: 218, protein: 20.1, fat: 16.5 });
    expect(exactItem(it_('100g raw salmon', 1, 1, 1, 1))).toMatchObject({ kcal: 124 });
    expect(exactItem(it_('tuna nigiri 3 pcs', 249, 18.6, 0.9, 24)).kcal).toBe(249);
    expect(exactItem(it_('canned tuna 70g', 99, 1, 1, 1)).kcal).toBe(99);
  });
});
