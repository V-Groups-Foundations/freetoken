// The diet coach's side channel. The model answers in plain words and, when something should be
// recorded (a food eaten, a weigh-in, new targets), appends a fenced ```diet block of JSON. The server
// reads those blocks once the reply has finished and writes them to the log; the page shows them as
// "logged" chips instead of code. Everything the model sends is validated: a block that doesn't parse
// records nothing.
import { z } from 'zod';

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] as const;
export type Meal = (typeof MEALS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = (max: number) => z.coerce.number().finite().min(0).max(max);

const item = z.object({
  meal: z.string().default('snack').transform((m) => (MEALS as readonly string[]).includes(m.toLowerCase()) ? (m.toLowerCase() as Meal) : 'snack'),
  name: z.string().trim().min(1).max(120),
  kcal: num(5000),
  protein: num(500).default(0),
  fat: num(500).default(0),
  carbs: num(1000).default(0),
  day: z.string().regex(DAY).optional(),
});

const targets = z.object({
  calories: num(10000).optional(),
  protein: num(1000).optional(),
  fat: num(1000).optional(),
  carbs: num(2000).optional(),
}).partial();

const profile = z.object({
  sex: z.enum(['male', 'female']).optional(),
  age: num(120).optional(),
  heightCm: num(260).optional(),
  goal: z.string().max(80).optional(),
  notes: z.string().max(600).optional(),
}).partial();

export const actionSchema = z.object({
  log: z.array(item).max(30).optional(),
  // entries to take back, by name as logged today ("I didn't eat the rice cake")
  remove: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  weight: num(400).optional(),
  targets: targets.optional(),
  profile: profile.optional(),
});
export type DietAction = z.infer<typeof actionSchema>;
export type LoggedItem = z.infer<typeof item>;

const BLOCK = /```diet\s*\n([\s\S]*?)```/g;

/** The actions in a reply's ```diet blocks; blocks that aren't valid JSON of the right shape are skipped. */
export function parseDietBlocks(text: string): DietAction[] {
  const out: DietAction[] = [];
  for (const m of text.matchAll(BLOCK)) {
    try {
      const r = actionSchema.safeParse(JSON.parse(m[1]));
      if (r.success) out.push(r.data);
    } catch { /* not JSON: nothing recorded */ }
  }
  return out;
}

/** The reply as the user reads it: the blocks taken out (a block still streaming in is hidden too). */
export function stripDietBlocks(text: string): string {
  return text.replace(BLOCK, '').replace(/```diet[\s\S]*$/, '').replace(/\n{3,}/g, '\n\n').trim();
}

export type Totals = { kcal: number; protein: number; fat: number; carbs: number };
export const sumTotals = (rows: Totals[]): Totals => rows.reduce(
  (a, r) => ({ kcal: a.kcal + r.kcal, protein: a.protein + r.protein, fat: a.fat + r.fat, carbs: a.carbs + r.carbs }),
  { kcal: 0, protein: 0, fat: 0, carbs: 0 },
);

export type CoachState = {
  today: string;
  profile: { sex?: string | null; age?: number | null; heightCm?: number | null; goal?: string | null; calories?: number | null; protein?: number | null; fat?: number | null; carbs?: number | null; notes?: string | null } | null;
  entries: { meal: string; name: string; kcal: number; protein: number; fat: number; carbs: number }[];
  week: { day: string; kcal: number; protein: number }[];
  weights: { day: string; kg: number }[];
};

const r = (n: number) => Math.round(n);

/** What the coach knows before it answers: the rules, then the user's numbers as of now. */
export function coachSystemPrompt(s: CoachState): string {
  const p = s.profile;
  const t = sumTotals(s.entries);
  const target = p?.calories ? `${p.calories} kcal · P ${p.protein ?? '?'} g · F ${p.fat ?? '?'} g · C ${p.carbs ?? '?'} g` : 'not set yet';
  const left = p?.calories
    ? `${r(p.calories - t.kcal)} kcal · P ${r((p.protein ?? 0) - t.protein)} g · F ${r((p.fat ?? 0) - t.fat)} g · C ${r((p.carbs ?? 0) - t.carbs)} g`
    : 'unknown (no targets)';
  const about = p ? [p.sex, p.age && `${p.age} y`, p.heightCm && `${p.heightCm} cm`, p.goal && `goal: ${p.goal}`, p.notes].filter(Boolean).join(', ') : '';
  const lastWeight = s.weights.at(-1);
  return `You are a precise, no-nonsense diet coach inside FreeToken. You track the user's food, calories and macros and help them plan meals.

How to answer:
- Short and direct. Answer only the latest message. A food log gets 1–3 lines: what was logged and what's left today. No headings, no emoji walls.
- Never repeat a plan, table or advice you already gave unless asked. No closing pitch, no list of offers, no disclaimers after the first time.
- Use a table only when the user asks for a plan or a breakdown. Keep plans to what was asked (one meal, one day).
- Use realistic values. For Japanese and branded products use the label values you know (e.g. SAVAS, Calorie Mate, konbini items); if unsure, say it's an estimate and give a sensible one.
- Photos: the user may send a photo of a meal or of a nutrition label (栄養成分表示). From a label, use its numbers exactly, scaled to what they had (per 100 g vs per pack). From a meal, name each food with an estimated amount in grams and say it's an estimate in a few words. Log what's in a photo as eaten unless the user says they're only asking; if it's unclear how much they ate, ask one short question instead of logging.
- Units: kcal and grams. The user's time zone day is ${s.today}.

Recording (the app reads this; the user doesn't see it): whenever the user says they ate or drank something, weighs in, or sets targets or personal details, end your reply with ONE block:
\`\`\`diet
{"log":[{"meal":"breakfast","name":"<food and amount>","kcal":0,"protein":0,"fat":0,"carbs":0}]}
\`\`\`
"meal" is one of breakfast, lunch, dinner, snack, drink. Other keys, only with values the user actually gave: "weight": kg; "targets": {"calories","protein","fat","carbs"}; "profile": {"sex":"male|female","age","heightCm","goal","notes"}; "remove": ["<name of an item logged today>"].
The block records only what the LATEST message newly reports. Food already listed under "Today so far" is logged already: never put it in "log" again (that counts it twice). Include "weight", "targets" or "profile" only when the latest message gives new values. Leave out the block entirely when there's nothing new to record.
One "log" item per food, with its amount in the name. "remove" takes back items logged today, by name. Add "day":"YYYY-MM-DD" to an item only if it was on another day. Never log food the user only asked about or is planning to eat.

The user now:
- About: ${about || 'nothing yet — ask for sex, age, height, weight and goal when it matters'}
- Daily targets: ${target}
- Weight: ${lastWeight ? `${lastWeight.kg} kg (${lastWeight.day})` : 'not logged'}${s.weights.length > 1 ? `, first logged ${s.weights[0].kg} kg (${s.weights[0].day})` : ''}
- Today (${s.today}) so far: ${s.entries.length ? s.entries.map((e) => `${e.meal}: ${e.name} ${r(e.kcal)} kcal P${r(e.protein)} F${r(e.fat)} C${r(e.carbs)}`).join('; ') : 'nothing logged'}
- Today total: ${r(t.kcal)} kcal · P ${r(t.protein)} g · F ${r(t.fat)} g · C ${r(t.carbs)} g
- Left today: ${left}
- Last days: ${s.week.length ? s.week.map((d) => `${d.day} ${r(d.kcal)} kcal P${r(d.protein)}`).join(', ') : 'no history'}`;
}
