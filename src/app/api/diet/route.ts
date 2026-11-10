import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { clearDietMessages, dietState, listDietMessages, shiftDay } from '@/diet/service';
import { dayParam } from '@/diet/day';
import { checkinDue } from '@/diet/checkin';

/** The tracker for one day (?day=YYYY-MM-DD, the user's own calendar day) and the coach conversation. */
export async function GET(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const db = getDb();
  const q = new URL(req.url).searchParams;
  const day = dayParam(q.get('day'));
  // the advisor's numbers are as of the user's today, whichever day the tracker shows
  const today = q.get('today') ? dayParam(q.get('today')) : day;
  const [state, messages] = await Promise.all([dietState(db, uid, day, today), listDietMessages(db, uid)]);
  // the weekly check-in is due: the page asks for it (POST /api/diet/checkin) once it has loaded
  const logged = state.week.filter((d) => d.day < today).length;
  const due = checkinDue(state.profile?.lastCheckin, today, logged, state.weights.filter((w) => w.day > shiftDay(today, -8)).length);
  return Response.json({ ...state, messages, checkinDue: due });
}

/** Start the coach conversation over (the food log, weights and targets stay). */
export async function DELETE() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  await clearDietMessages(getDb(), uid);
  return Response.json({ ok: true });
}
