import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { deleteWeight, setWeight } from '@/diet/service';
import { dayParam } from '@/diet/day';

/** Log a weigh-in ({ kg, day }); a second one the same day replaces it. */
export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const p = z.object({ kg: z.coerce.number().finite().min(20).max(400), day: z.string().optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Enter a weight in kg.' }, { status: 400 });
  await setWeight(getDb(), uid, dayParam(p.data.day), Math.round(p.data.kg * 10) / 10);
  return Response.json({ ok: true });
}

/** Take back a weigh-in (?day=YYYY-MM-DD). */
export async function DELETE(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const day = new URL(req.url).searchParams.get('day') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: 'Bad day.' }, { status: 400 });
  await deleteWeight(getDb(), uid, day);
  return Response.json({ ok: true });
}
