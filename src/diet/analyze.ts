// Have a vision model read a progress photo (next to the first photo of the same pose, to compare), store
// the read, and post it into the coach conversation so the coach knows what it showed.
import { and, asc, eq, ne } from 'drizzle-orm';
import type { DB } from '@/db';
import { dietPhotos } from '@/db/schema';
import { completeText } from '@/server/complete';
import { imageType } from '@/images/gallery';
import { advise } from './advisor';
import { parsePhysique, physiquePrompt, type Pose, type PhysiqueRead } from './physique';
import { addDietMessage, bodyFatText, dayTotals, getProfile, listWeights, saveAnalysis } from './service';
import { currentPlan, generatePlan } from './plan';

const dataUrl = (b: Buffer) => `data:${imageType(b)};base64,${b.toString('base64')}`;

export async function analyzePhoto(db: DB, userId: string, id: number, today: string): Promise<{ ok: true; read: PhysiqueRead; planChange?: string } | { ok: false; status: number; message: string }> {
  const [photo] = await db.select().from(dietPhotos).where(and(eq(dietPhotos.id, id), eq(dietPhotos.userId, userId)));
  if (!photo) return { ok: false, status: 404, message: 'Photo not found.' };
  const [first] = await db.select().from(dietPhotos)
    .where(and(eq(dietPhotos.userId, userId), eq(dietPhotos.pose, photo.pose), ne(dietPhotos.id, id)))
    .orderBy(asc(dietPhotos.day), asc(dietPhotos.id)).limit(1);
  const earlier = first && first.day <= photo.day ? first : undefined;
  const [profile, weights, logs] = await Promise.all([getProfile(db, userId), listWeights(db, userId, 365), dayTotals(db, userId, today, 28)]);
  const about = profile ? [profile.sex, profile.age && `${profile.age} y`, profile.heightCm && `${profile.heightCm} cm`, profile.goal && `goal: ${profile.goal}`].filter(Boolean).join(', ') : '';

  const prompt = physiquePrompt({
    pose: photo.pose as Pose, about, weightKg: photo.kg ?? weights.at(-1)?.kg ?? null, advice: advise(profile, weights, logs, today),
    previous: earlier ? { day: earlier.day, bodyFat: bodyFatText(earlier), summary: earlier.summary } : null,
    comparing: Boolean(earlier),
  });
  const res = await completeText(userId, [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: dataUrl(Buffer.from(photo.data)) } },
      ...(earlier ? [{ type: 'image_url' as const, image_url: { url: dataUrl(Buffer.from(earlier.data)) } }] : []),
    ],
  }], { task: 'vision', temperature: 0.3, session: `diet:${userId}` });
  if (!res.ok) return res;

  const read = parsePhysique(res.text);
  if (!read.text) return { ok: false, status: 502, message: 'The model gave no analysis — try again.' };
  await saveAnalysis(db, userId, id, read);
  await addDietMessage(db, userId, { role: 'user', content: `📷 progress photo (${photo.pose}, ${photo.day}) — analyse my physique` });
  await addDietMessage(db, userId, { role: 'assistant', content: read.text, provider: res.provider });

  // what the photo shows feeds the training plan: lagging areas get more work (if there is a plan to revise)
  let planChange: string | undefined;
  if (await currentPlan(db, userId)) {
    const p = await generatePlan(db, userId, today, {
      source: 'photo',
      instruction: `A new ${photo.pose} progress photo was just read: "${(read.summary ?? read.text).slice(0, 700)}". If it shows lagging areas the plan doesn't already prioritise, adjust volume, exercise choice or order for them; if the plan already covers them, keep it unchanged and say "No change needed".`,
    });
    if (p.ok) {
      planChange = p.change || 'Plan reviewed.';
      await addDietMessage(db, userId, { role: 'assistant', content: `**Training plan:** ${planChange}` });
    }
  }
  return { ok: true, read, planChange };
}
