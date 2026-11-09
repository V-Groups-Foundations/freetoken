import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { clearDietMessages, dietState, listDietMessages } from '@/diet/service';
import { dayParam } from '@/diet/day';

/** The tracker for one day (?day=YYYY-MM-DD, the user's own calendar day) and the coach conversation. */
export async function GET(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const db = getDb();
  const day = dayParam(new URL(req.url).searchParams.get('day'));
  const [state, messages] = await Promise.all([dietState(db, uid, day), listDietMessages(db, uid)]);
  return Response.json({ ...state, messages });
}

/** Start the coach conversation over (the food log, weights and targets stay). */
export async function DELETE() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  await clearDietMessages(getDb(), uid);
  return Response.json({ ok: true });
}
