import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { dietWeights } from '@/db/schema';
import { sessionUserId } from '@/lib/session';
import { dataUrlBytes } from '@/images/gallery';
import { addPhoto, listPhotos } from '@/diet/service';
import { analyzePhoto } from '@/diet/analyze';
import { POSES } from '@/diet/physique';
import { dayParam } from '@/diet/day';

export const maxDuration = 300; // reading a photo with a free vision model can take a while

/** The user's progress photos, newest first (without the pictures: /api/diet/photos/<id>). */
export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  return Response.json({ photos: await listPhotos(getDb(), uid) });
}

/** Save a progress photo (a JPEG/PNG/WebP data URL) and, unless analyze is false, have the coach read it. */
export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const p = z.object({
    image: z.string().startsWith('data:image/').max(8_000_000),
    pose: z.enum(POSES).default('front'),
    day: z.string().optional(),
    analyze: z.boolean().default(true),
  }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'A photo is required.' }, { status: 400 });
  const bytes = dataUrlBytes(p.data.image);
  const isImage = bytes && bytes.length > 100 && ((bytes[0] === 0xff && bytes[1] === 0xd8) || (bytes[0] === 0x89 && bytes[1] === 0x50) || (bytes[0] === 0x52 && bytes[8] === 0x57));
  if (!bytes || !isImage) return Response.json({ error: 'That file is not a JPEG, PNG or WebP picture.' }, { status: 400 });

  const db = getDb();
  const day = dayParam(p.data.day);
  const [w] = await db.select({ kg: dietWeights.kg }).from(dietWeights).where(and(eq(dietWeights.userId, uid), eq(dietWeights.day, day)));
  const id = await addPhoto(db, uid, { day, pose: p.data.pose, data: bytes, kg: w?.kg ?? null });
  if (!p.data.analyze) return Response.json({ id });
  const a = await analyzePhoto(db, uid, id, day);
  // the photo is kept even when the read fails; it can be read again from the page
  return Response.json(a.ok ? { id, analysis: a.read, planChange: a.planChange } : { id, error: a.message });
}
