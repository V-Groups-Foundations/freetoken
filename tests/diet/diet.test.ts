import { describe, it, expect } from 'vitest';
import { cleanReply, coachSystemPrompt, parseDietBlocks, stripDietBlocks } from '@/diet/protocol';
import { applyDietActions, coachState, dietState, savedReply, shiftDay } from '@/diet/service';
import { CHAT_STYLE, withChatStyle } from '@/chat/style';
import { createTestDb, createUser } from '../helpers/db';

const reply = (json: string) => `Logged: SAVAS 30 g — 117 kcal, 24 g protein. Left today: 1883 kcal.\n\n\`\`\`diet\n${json}\n\`\`\``;

describe('diet coach blocks', () => {
  it('reads what the coach recorded and hides the block from the reply', () => {
    const text = reply('{"log":[{"meal":"breakfast","name":"SAVAS whey coffee 30 g","kcal":117,"protein":24.3,"fat":1.5,"carbs":3.6}],"weight":"95.2"}');
    const [a] = parseDietBlocks(text);
    expect(a.log?.[0]).toMatchObject({ meal: 'breakfast', name: 'SAVAS whey coffee 30 g', kcal: 117, protein: 24.3 });
    expect(a.weight).toBe(95.2); // numbers sent as strings still count
    expect(stripDietBlocks(text)).toBe('Logged: SAVAS 30 g — 117 kcal, 24 g protein. Left today: 1883 kcal.');
  });
  it('a block still streaming in is hidden too; an unknown meal is a snack; missing macros are 0', () => {
    expect(stripDietBlocks('Logged.\n\n```diet\n{"log":[{"na')).toBe('Logged.');
    const [a] = parseDietBlocks(reply('{"log":[{"meal":"Second breakfast","name":"apple","kcal":52}]}'));
    expect(a.log?.[0]).toMatchObject({ meal: 'snack', protein: 0, fat: 0, carbs: 0 });
  });
  it('records nothing from a block that is not valid (bad JSON, negative or absurd numbers)', () => {
    expect(parseDietBlocks(reply('{"log":[{"name":"x","kcal":'))).toEqual([]);
    expect(parseDietBlocks(reply('{"log":[{"name":"x","kcal":-50}]}'))).toEqual([]);
    expect(parseDietBlocks(reply('{"log":[{"name":"x","kcal":99999}]}'))).toEqual([]);
    expect(parseDietBlocks('no block here')).toEqual([]);
  });
  it("the coach is told to be brief and is given the user's numbers and what's left", () => {
    const p = coachSystemPrompt({
      today: '2026-11-09',
      profile: { sex: 'male', age: 23, heightCm: 186, goal: 'cut', calories: 2000, protein: 175, fat: 55, carbs: 200, notes: null },
      entries: [{ meal: 'breakfast', name: 'SAVAS 30 g', kcal: 117, protein: 24.3, fat: 1.5, carbs: 3.6 }],
      week: [{ day: '2026-11-08', kcal: 1950, protein: 170 }],
      weights: [{ day: '2026-11-01', kg: 95 }, { day: '2026-11-09', kg: 94.4 }],
    });
    expect(p).toMatch(/Short and direct/);
    expect(p).toMatch(/Never repeat a plan/);
    expect(p).toMatch(/Left today: 1883 kcal · P 151 g · F 54 g · C 196 g/);
    expect(p).toMatch(/94\.4 kg \(2026-11-09\), first logged 95 kg/);
    expect(p).toMatch(/2026-11-08 1950 kcal/);
  });
});

describe('diet log', () => {
  it('logs food, takes items back by name, records weight and targets, and totals the day', async () => {
    const db = await createTestDb();
    const { id } = await createUser(db);
    const day = '2026-11-09';
    await applyDietActions(db, id, day, parseDietBlocks(reply(JSON.stringify({
      log: [
        { meal: 'breakfast', name: 'SAVAS whey coffee 30 g', kcal: 117, protein: 24.3, fat: 1.5, carbs: 3.6 },
        { meal: 'snack', name: '1 rice cake (10 g)', kcal: 38, protein: 0.7, fat: 0.3, carbs: 8 },
        { meal: 'dinner', name: 'grilled chicken 150 g', kcal: 210, protein: 30, fat: 9, carbs: 0, day: shiftDay(day, -1) },
      ],
      weight: 95.2,
      targets: { calories: 2000, protein: 175, fat: 55, carbs: 200 },
      profile: { sex: 'male', age: 23, heightCm: 186, goal: 'cut' },
    }))));
    let s = await dietState(db, id, day);
    expect(s.entries.map((e) => e.name)).toEqual(['SAVAS whey coffee 30 g', '1 rice cake (10 g)']);
    expect(Math.round(s.totals.kcal)).toBe(155);
    expect(s.profile).toMatchObject({ calories: 2000, protein: 175, age: 23, heightCm: 186, goal: 'cut' });
    expect(s.weights).toEqual([{ day, kg: 95.2 }]);
    expect(s.week.map((d) => d.day)).toEqual(['2026-11-08', day]); // yesterday's dinner went to yesterday

    const done = await applyDietActions(db, id, day, [{ remove: ['rice cake'] }, { weight: 94.9 }]);
    expect(done).toEqual({ remove: ['1 rice cake (10 g)'], weight: 94.9 });
    s = await dietState(db, id, day);
    expect(s.entries.map((e) => e.name)).toEqual(['SAVAS whey coffee 30 g']);
    expect(s.weights).toEqual([{ day, kg: 94.9 }]); // a second weigh-in that day replaces the first

    // the coach is told today item by item, and earlier days as totals
    const c = await coachState(db, id, day);
    expect(c.entries).toHaveLength(1);
    expect(c.week.map((d) => d.day)).toEqual(['2026-11-08']);
  });
  it('a model re-sending what is already logged (food, weight, targets) records nothing twice — unless the user names it again', async () => {
    const db = await createTestDb();
    const { id } = await createUser(db);
    const day = '2026-11-09';
    const savas = { meal: 'breakfast' as const, name: 'SAVAS whey coffee 30 g', kcal: 117, protein: 24.3, fat: 1.5, carbs: 3.6 };
    await applyDietActions(db, id, day, [{ log: [savas], weight: 95, targets: { calories: 2000, protein: 175 } }], 'breakfast: savas shake');
    // next turn the model sends the shake, the weight and the targets again with the new lunch
    const again = await applyDietActions(db, id, day, [{
      log: [savas, { meal: 'lunch', name: 'salmon onigiri', kcal: 180, protein: 5, fat: 2, carbs: 38 }],
      weight: 95, targets: { calories: 2000, protein: 175 },
    }], 'lunch was a salmon onigiri');
    expect(again).toEqual({ log: [expect.objectContaining({ name: 'salmon onigiri' })] });
    expect((await dietState(db, id, day)).entries.map((e) => e.name)).toEqual(['SAVAS whey coffee 30 g', 'salmon onigiri']);
    // "another SAVAS" names it: a second one is logged
    await applyDietActions(db, id, day, [{ log: [savas] }], 'had another savas after the gym');
    expect((await dietState(db, id, day)).entries).toHaveLength(3);
    // what gets saved with the reply is what was recorded, not what the model sent
    expect(savedReply('Logged.\n\n```diet\n{"weight":95}\n```', {})).toBe('Logged.');
    expect(savedReply('Logged.', again)).toMatch(/^Logged\.\n\n```diet\n\{"log":\[\{"meal":"lunch","name":"salmon onigiri"/);
  });
  it("one user's log is not another's", async () => {
    const db = await createTestDb();
    const a = await createUser(db), b = await createUser(db);
    await applyDietActions(db, a.id, '2026-11-09', [{ log: [{ meal: 'lunch', name: 'ramen', kcal: 600, protein: 25, fat: 20, carbs: 80 }] }]);
    expect((await dietState(db, b.id, '2026-11-09')).entries).toEqual([]);
  });
});

describe('chat style', () => {
  it('every chat asks for precise answers without reports, repeats or closing pitches', () => {
    const m = withChatStyle([{ role: 'user', content: 'hi' }]);
    expect(m[0]).toEqual({ role: 'system', content: CHAT_STYLE });
    expect(CHAT_STYLE).toMatch(/Don't repeat what you already said/);
    expect(CHAT_STYLE).toMatch(/No closing pitch/);
  });
});

describe('leaked reasoning', () => {
  it('drops thinking that was cut off before any answer (what Cloudflare sent on 2026-11-10)', () => {
    const leaked = 'analysis\n\nWe need to decipher user request: "Okau for dinner how muxh chciken". Chicken breast raw per 100g approx 165 kcal… Rice cooked per 100g';
    expect(cleanReply(leaked)).toBe('');
    expect(stripDietBlocks(leaked)).toBe('');
  });
  it('keeps only the answer after the thinking, and leaves normal replies alone', () => {
    expect(cleanReply('analysisThey want chicken and rice.assistantfinalTake 200 g raw chicken and 180 g cooked rice.')).toBe('Take 200 g raw chicken and 180 g cooked rice.');
    expect(cleanReply('Analysis: your day is on target.')).toBe('Analysis: your day is on target.');
    const normal = 'Your analysis: dinner adds 363 kcal.';
    expect(cleanReply(normal)).toBe(normal);
  });
});
