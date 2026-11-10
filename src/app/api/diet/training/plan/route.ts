import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { currentPlan, generatePlan } from '@/diet/plan';
import { dayParam } from '@/diet/day';

export const maxDuration = 300; // writing a plan with a free model can take a while

/** Write a plan, or rewrite it ({ instruction: "no barbell squats", … } or nothing for a fresh take). */
export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const p = z.object({ instruction: z.string().trim().max(600).optional(), fresh: z.boolean().optional(), today: z.string().optional() })
    .safeParse(await req.json().catch(() => ({})));
  if (!p.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });
  const db = getDb();
  const has = await currentPlan(db, uid);
  const instruction = p.data.instruction
    || (has && p.data.fresh ? 'Write a fresh plan from scratch for their current details, photos and lifts; say how it differs from the old one.' : null);
  const r = await generatePlan(db, uid, dayParam(p.data.today), { instruction, source: has ? 'request' : 'new' });
  return r.ok ? Response.json({ plan: r.plan, change: r.change }) : Response.json({ error: r.message }, { status: r.status });
}
