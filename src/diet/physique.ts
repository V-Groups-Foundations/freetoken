// Reading a body progress photo: what the vision model is asked, and how its answer is taken apart.
// The answer is a short write-up for the user, then a ```physique block the app stores (body-fat range,
// a one-line summary the coach remembers in later conversations).
import { z } from 'zod';
import type { Advice } from './advisor';

export const POSES = ['front', 'side', 'back', 'other'] as const;
export type Pose = (typeof POSES)[number];

const BLOCK = /```physique\s*\n([\s\S]*?)```/;
const result = z.object({
  bodyFatLow: z.coerce.number().min(3).max(60).optional(),
  bodyFatHigh: z.coerce.number().min(3).max(65).optional(),
  summary: z.string().trim().max(400).optional(),
});
export type PhysiqueRead = { text: string; bodyFatLow: number | null; bodyFatHigh: number | null; summary: string | null };

export function parsePhysique(reply: string): PhysiqueRead {
  const m = BLOCK.exec(reply);
  let data: z.infer<typeof result> = {};
  if (m) { try { data = result.parse(JSON.parse(m[1])); } catch { /* keep the words, skip the numbers */ } }
  let lo = data.bodyFatLow ?? null, hi = data.bodyFatHigh ?? null;
  if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
  const text = reply.replace(BLOCK, '').replace(/```physique[\s\S]*$/, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, bodyFatLow: lo, bodyFatHigh: hi ?? lo, summary: data.summary ?? null };
}

export type PhysiqueContext = {
  pose: Pose;
  about: string; // sex, age, height, goal…
  weightKg: number | null;
  advice: Advice | null;
  previous: { day: string; bodyFat: string | null; summary: string | null } | null; // the first photo of this pose
  comparing: boolean; // the first photo of this pose is attached as the second picture
};

export function physiquePrompt(c: PhysiqueContext): string {
  return `You are an experienced physique coach (bodybuilding and sports nutrition) reviewing a client's ${c.pose} progress photo.
Client: ${c.about || 'details not given'}${c.weightKg ? `, ${c.weightKg} kg` : ''}.${c.advice?.maintenance ? ` Maintenance ≈ ${c.advice.observedMaintenance ?? c.advice.maintenance} kcal.` : ''}${c.advice?.trendKgPerWeek != null ? ` Weight trend ${c.advice.trendKgPerWeek} kg/week.` : ''}
${c.previous ? `Their first ${c.pose} photo (${c.previous.day}) was read as: ${c.previous.bodyFat ? `~${c.previous.bodyFat}% body fat, ` : ''}${c.previous.summary ?? ''}` : 'This is their first photo of this pose.'}
${c.comparing ? 'The FIRST picture is today; the SECOND is that first photo — compare them.' : ''}

Write, in plain markdown, at most ~180 words:
1. **Body fat:** an estimated range (e.g. 18–21%) and what you see that puts it there.
2. **Strong points** and **lagging areas** (muscle groups), and anything about posture or symmetry worth fixing.
${c.comparing ? '3. **Change since the first photo:** what improved or not, honestly.\n4.' : '3.'} **Do next:** the 2–3 most important changes for their goal — calories/protein (use their numbers if given), and training focus.
Be frank and respectful, like a good coach. Comment only on physique. If the picture isn't a body photo or is too unclear to judge, say so in one line and skip the rest.

Then end with exactly one block:
\`\`\`physique
{"bodyFatLow": 0, "bodyFatHigh": 0, "summary": "<one sentence: body-fat range, main strength, main weakness>"}
\`\`\`
Leave out bodyFatLow/bodyFatHigh if you can't judge.`;
}
