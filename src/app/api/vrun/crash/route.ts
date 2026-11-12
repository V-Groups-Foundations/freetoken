import { z } from 'zod';
import { getDb } from '@/db';
import { getDeps } from '@/server/deps';
import { clientIp } from '@/server/site';
import { recordCrash } from '@/server/vrun-crashes';

// V-Run sends a crash or unhandled error here (no account needed, nothing personal in it — see scrub()).
// At most 20 reports per network per hour, so a broken install or someone scripting it can't flood it.
const report = z.object({
  version: z.string().trim().min(1).max(40),
  os: z.string().trim().min(1).max(80),
  kind: z.enum(['main-error', 'rejection', 'renderer-gone', 'child-gone', 'renderer-error']),
  message: z.string().trim().min(1).max(2000),
  stack: z.string().max(12_000).optional(),
});

export async function POST(req: Request) {
  const p = report.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Bad report.' }, { status: 400 });
  const kv = getDeps().kv;
  const key = `vrun-crash:${await clientIp()}:${new Date().toISOString().slice(0, 13)}`;
  const n = Number((await kv.get(key)) ?? 0);
  if (n >= 20) return Response.json({ ok: true, dropped: true });
  await kv.set(key, String(n + 1), 3_600_000);
  await recordCrash(getDb(), p.data);
  return Response.json({ ok: true });
}
