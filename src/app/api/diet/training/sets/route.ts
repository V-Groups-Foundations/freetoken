import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { logSets } from '@/diet/plan';
import { dayParam } from '@/diet/day';

/** Log a workout: { day, sets: [{ exercise, kg, reps }, …] } (one entry per set). */
export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const p = z.object({
    day: z.string().optional(),
    sets: z.array(z.object({ exercise: z.string().trim().min(2).max(80), kg: z.coerce.number().finite().min(0).max(1000), reps: z.coerce.number().int().min(1).max(100) })).min(1).max(80),
  }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Add at least one set with reps.' }, { status: 400 });
  const n = await logSets(getDb(), uid, dayParam(p.data.day), p.data.sets);
  return Response.json({ logged: n });
}
