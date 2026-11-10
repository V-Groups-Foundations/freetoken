import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { dayParam } from '@/diet/day';
import { generateCheckin, isCheckinDue } from '@/diet/checkin';

export const maxDuration = 120;

/** Write this week's check-in into the coach conversation: when it's due, or now ({ force: true }). */
export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const p = z.object({ today: z.string().optional(), force: z.boolean().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!p.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });
  const db = getDb();
  const today = dayParam(p.data.today);
  if (!p.data.force && !(await isCheckinDue(db, uid, today))) return Response.json({ skipped: true });
  const r = await generateCheckin(db, uid, today);
  return r.ok ? Response.json({ text: r.text }) : Response.json({ error: r.message }, { status: r.status });
}
