import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { deleteWeight } from '@/diet/service';

/** Take back a weigh-in (?day=YYYY-MM-DD). */
export async function DELETE(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const day = new URL(req.url).searchParams.get('day') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ error: 'Bad day.' }, { status: 400 });
  await deleteWeight(getDb(), uid, day);
  return Response.json({ ok: true });
}
