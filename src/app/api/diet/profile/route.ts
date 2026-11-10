import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { and, eq } from 'drizzle-orm';
import { dietPhotos } from '@/db/schema';
import { updateProfile } from '@/diet/service';
import { ACTIVITY } from '@/diet/advisor';
import { EQUIPMENT, EXPERIENCE, type Equipment } from '@/diet/training';

const n = (max: number) => z.coerce.number().finite().min(0).max(max).nullable().optional();

/** Targets and personal details, edited on the page. */
export async function PATCH(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const p = z.object({
    calories: n(10000), protein: n(1000), fat: n(1000), carbs: n(2000), age: n(120), heightCm: n(260),
    sex: z.enum(['male', 'female']).nullable().optional(), goal: z.string().max(80).nullable().optional(), notes: z.string().max(600).nullable().optional(),
    activity: z.enum(Object.keys(ACTIVITY) as [keyof typeof ACTIVITY]).nullable().optional(), goalWeightKg: n(400),
    photoId: z.number().int().positive().nullable().optional(), // the profile picture: one of their progress photos
    trainDays: z.coerce.number().int().min(1).max(7).nullable().optional(), sessionMinutes: z.coerce.number().int().min(15).max(240).nullable().optional(),
    experience: z.enum(EXPERIENCE).nullable().optional(), equipment: z.enum(Object.keys(EQUIPMENT) as [Equipment]).nullable().optional(),
    injuries: z.string().max(400).nullable().optional(),
  }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Invalid values.' }, { status: 400 });
  const db = getDb();
  if (p.data.photoId) {
    const [mine] = await db.select({ id: dietPhotos.id }).from(dietPhotos).where(and(eq(dietPhotos.id, p.data.photoId), eq(dietPhotos.userId, uid)));
    if (!mine) return Response.json({ error: 'Photo not found.' }, { status: 404 });
  }
  await updateProfile(db, uid, p.data);
  return Response.json({ ok: true });
}
