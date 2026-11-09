import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { updateProfile } from '@/diet/service';

const n = (max: number) => z.coerce.number().finite().min(0).max(max).nullable().optional();

/** Targets and personal details, edited on the page. */
export async function PATCH(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const p = z.object({
    calories: n(10000), protein: n(1000), fat: n(1000), carbs: n(2000), age: n(120), heightCm: n(260),
    sex: z.enum(['male', 'female']).nullable().optional(), goal: z.string().max(80).nullable().optional(), notes: z.string().max(600).nullable().optional(),
  }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Invalid values.' }, { status: 400 });
  await updateProfile(getDb(), uid, p.data);
  return Response.json({ ok: true });
}
