import { z } from 'zod';
import { resolveUserId } from '@/server/identity';
import { getDeps } from '@/server/deps';
import { recordFeedback } from '@/usage/ledger';
import { parseModelRef } from '@/router/select';

const schema = z.object({
  /** "provider/modelId", as the x-freetoken-provider response header named it */
  model: z.string().trim().min(3).max(200),
  task: z.enum(['agent', 'code', 'reasoning', 'vision', 'creative', 'chat']).default('agent'),
  good: z.boolean(),
  // a long reason (a failure with its error output) is trimmed, not refused: refusing it dropped every
  // failed benchmark run, so only the passes were ever counted
  reason: z.string().optional().transform((s) => s?.slice(0, 200)),
});

/** A client tells auto routing how a model's answer worked out (V-Run reports broken tool calls, false
 * claims and verified finished tasks); the router learns from it. Browser session or an ft_ token. */
export async function POST(req: Request) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  const ref = parsed.success ? parseModelRef(parsed.data.model) : null;
  if (!parsed.success || !ref) return Response.json({ error: 'Send { model: "provider/model", good: true|false }.' }, { status: 400 });
  await recordFeedback(getDeps().db, { userId: uid, ...ref, task: parsed.data.task, good: parsed.data.good, reason: parsed.data.reason });
  return Response.json({ ok: true });
}
