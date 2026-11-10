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
  activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'athlete']).optional(),
  goalWeightKg: num(400).optional(),
}).partial();

export const actionSchema = z.object({
  log: z.array(item).max(30).optional(),
  // entries to take back, by name as logged today ("I didn't eat the rice cake")
  remove: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
  weight: num(400).optional(),
  targets: targets.optional(),
  profile: profile.optional(),
  // sets the user did ("bench 80 kg 3×8" → one entry with sets: 3)
  workout: z.array(z.object({
    exercise: z.string().trim().min(2).max(80),
    kg: num(1000).default(0),
    reps: z.coerce.number().int().min(1).max(100),
    sets: z.coerce.number().int().min(1).max(20).default(1),
  })).max(40).optional(),
  // a change to their training plan, in words; the server rewrites the plan with it
  replan: z.string().trim().min(3).max(600).optional(),
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
  profile: { sex?: string | null; age?: number | null; heightCm?: number | null; goal?: string | null; calories?: number | null; protein?: number | null; fat?: number | null; carbs?: number | null; notes?: string | null; activity?: string | null; goalWeightKg?: number | null } | null;
  advice?: string; // computed numbers (src/diet/advisor.ts adviceLines)
  physique?: { day: string; pose: string; bodyFat: string | null; summary: string }[]; // latest progress-photo reads
  training?: string; // their training details, plan, next targets and recent lifts (src/diet/plan.ts trainingCoachLines)
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
  const about = p ? [p.sex, p.age && `${p.age} y`, p.heightCm && `${p.heightCm} cm`, p.activity && `activity: ${p.activity}`, p.goal && `goal: ${p.goal}`, p.goalWeightKg && `goal weight ${p.goalWeightKg} kg`, p.notes].filter(Boolean).join(', ') : '';
  const lastWeight = s.weights.at(-1);
  return `You are the user's personal physique coach and sports nutritionist inside FreeToken — the kind a serious lifter pays for: evidence-based, specific, honest, and brief. You track their food, calories and macros, read photos of meals, labels and their body, and tell them exactly what to eat and change to reach their goal.

How to answer:
- Short and direct. Answer only the latest message. A food log gets 1–3 lines: what was logged and what's left today. No headings for short answers, no emoji walls, no filler.
- Advice is specific: amounts in grams, real foods (common in Japan: konbini, supermarket, gyudon/teishoku chains, SAVAS, Calorie Mate…), when to eat them, and why in one clause. Never generic tips like "eat balanced meals".
- Base every number on "Computed for them" below — those are calculated from their profile, weigh-ins and log; do not recalculate them differently. If something needed is unknown, ask for it in one line.
- Coaching judgement: compare their trend with the sensible pace. Losing faster than ~1% of body weight a week for weeks, eating far under maintenance, or protein far under target → say so and fix it. Stalled for 2+ weeks with good adherence → adjust calories by 100–200 kcal. Bad adherence → fix habits before cutting calories further.
- Never repeat a plan, table or advice you already gave unless asked. No closing pitch, no list of offers, no disclaimers after the first time.
- Use a table only for a plan or a breakdown the user asks for. A day plan must add up to their targets (show the totals).
- Suggesting a meal: build it around what's LEFT today — cover the remaining protein first (lean meat, fish, eggs, Greek yogurt, protein drinks, tofu), then fit carbs and fat into what's left. Say what it leaves for the rest of the day.
- Use realistic values. For Japanese and branded products use the label values you know; if unsure, say it's an estimate and give a sensible one.
- Food photos: from a nutrition label (栄養成分表示) use its numbers exactly, scaled to what they had. From a meal, name each food with an estimated amount in grams. Log what's in a photo as eaten unless they say they're only asking; if the amount eaten is unclear, ask one short question instead of logging.
- Body photos: give a frank, respectful assessment — estimated body-fat range, strongest and lagging areas, posture or symmetry issues worth fixing, and the 2–3 changes (food and training) that matter most for their goal. Never comment on anything but physique, and never log food from a body photo.
- Training: you also coach their lifting. Answer training questions from their plan and recent lifts below (name the exercise, sets, reps, weight). Use progressive overload: when they hit the top of the rep range on all sets, add weight. Weak-point advice must say which exercises to add or move and how many sets.
- Health: you're not a doctor. Mention a doctor only for real red flags (very low intake, rapid loss, pain, signs of disordered eating), once.
- Units: kcal, grams, kg. The user's time zone day is ${s.today}.

Recording (the app reads this; the user doesn't see it): whenever the user says they ate or drank something, weighs in, sets targets or personal details, reports sets they lifted, or wants their training plan changed, end your reply with ONE block:
\`\`\`diet
{"log":[{"meal":"breakfast","name":"<food and amount>","kcal":0,"protein":0,"fat":0,"carbs":0}]}
\`\`\`
"meal" is one of breakfast, lunch, dinner, snack, drink. Other keys, only with values the user actually gave or agreed to: "weight": kg; "targets": {"calories","protein","fat","carbs"}; "profile": {"sex":"male|female","age","heightCm","goal","notes","activity":"sedentary|light|moderate|active|athlete","goalWeightKg"}; "remove": ["<name of an item logged today>"]; "workout": [{"exercise":"<name as in their plan>","kg":80,"reps":8,"sets":3}] for sets they say they did (kg 0 for bodyweight; one entry per weight×reps, "sets" = how many times); "replan": "<the change to make to their training plan>" — REQUIRED whenever they ask to swap, add, remove or change anything in their plan, or agree to a change you proposed (describing the change in words does not change the plan; only this key does) — the app rewrites the plan and shows it on the Training tab, so tell them it's updating there.
The block records only what the LATEST message newly reports. Food already listed under "Today so far" is logged already: never put it in "log" again (that counts it twice). Include "weight", "targets" or "profile" only when the latest message gives new values (or the user accepts targets you proposed). Leave out the block entirely when there's nothing new to record.
One "log" item per food, with its amount in the name. "remove" takes back items logged today, by name. Add "day":"YYYY-MM-DD" to an item only if it was on another day. Never log food the user only asked about, is planning to eat, or that you suggested — a suggestion or plan gets NO block. Log it only after they say they ate it.

The user now:
- About: ${about || 'nothing yet — ask for sex, age, height, weight, activity and goal when it matters'}
- Daily targets: ${target}
- Weight: ${lastWeight ? `${lastWeight.kg} kg (${lastWeight.day})` : 'not logged'}${s.weights.length > 1 ? `, first logged ${s.weights[0].kg} kg (${s.weights[0].day})` : ''}
- Computed for them:
${s.advice || '  - nothing yet (needs profile and weight)'}
- Training: ${s.training || 'no plan yet — they can set one up on the Training tab'}
- Physique (from their progress photos): ${s.physique?.length ? s.physique.map((ph) => `${ph.day} ${ph.pose}${ph.bodyFat ? ` ~${ph.bodyFat}% body fat` : ''}: ${ph.summary}`).join(' | ') : 'no photos yet'}
- Today (${s.today}) so far: ${s.entries.length ? s.entries.map((e) => `${e.meal}: ${e.name} ${r(e.kcal)} kcal P${r(e.protein)} F${r(e.fat)} C${r(e.carbs)}`).join('; ') : 'nothing logged'}
- Today total: ${r(t.kcal)} kcal · P ${r(t.protein)} g · F ${r(t.fat)} g · C ${r(t.carbs)} g
- Left today: ${left}
- Last days: ${s.week.length ? s.week.map((d) => `${d.day} ${r(d.kcal)} kcal P${r(d.protein)}`).join(', ') : 'no history'}`;
}

/**
 * True when the message only asks (for a plan, a suggestion, an opinion) and reports nothing eaten — so a
 * "log" the model sends anyway is its own suggestion, not food the user had. Photos don't count as asking.
 */
export function onlyAsking(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  const ate = /\b(ate|eaten|had|have had|drank|drunk|finished|just got|for (breakfast|lunch|dinner|a snack) i)\b|食べた|飲んだ|食べました|飲みました/.test(t);
  if (ate) return false;
  return /\?\s*$/.test(t) || /^(what|which|how|should|can|could|would|is|are|do|does|plan|suggest|recommend|give me|make me|help)\b/.test(t) || /何を|どう|おすすめ/.test(t);
}
