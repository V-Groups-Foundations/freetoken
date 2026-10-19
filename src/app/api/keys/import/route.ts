import { z } from 'zod';
import { getDb } from '@/db';
import { detectEnvKeys, detectKeys, maskKey, type DetectedKey } from '@/keys/detect';
import { sessionUserId } from '@/lib/session';
import { getProvider } from '@/providers/registry';
import { getDeps } from '@/server/deps';
import { handleSaveKey } from '@/server/keys-handlers';
import { localLoginEnabled, localOwner } from '@/server/local-login';

/**
 * Keys in this server's environment belong to whoever runs it, so only that person (the local owner
 * on a self-hosted install) may see or import them — never other users of a shared deployment.
 */
async function canUseServerEnv(uid: string) {
  return localLoginEnabled() && (await localOwner(getDb())).id === uid;
}

/** Keys found in this computer's environment variables (masked; the values never leave the server). */
export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!(await canUseServerEnv(uid))) return Response.json({ found: [] });
  return Response.json({ found: detectEnvKeys().map((k) => ({ provider: k.provider, name: getProvider(k.provider)?.name ?? k.provider, source: k.source, masked: maskKey(k.key) })) });
}

/** Save every key found in pasted text (or in the environment): each is tested before it's stored. */
export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const p = z.object({ text: z.string().max(20_000).optional(), fromEnv: z.boolean().optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success || (!p.data.text && !p.data.fromEnv)) return Response.json({ error: 'Paste one or more keys.' }, { status: 400 });

  let found: DetectedKey[];
  let unrecognized = 0;
  if (p.data.fromEnv) {
    if (!(await canUseServerEnv(uid))) return Response.json({ error: 'Not allowed.' }, { status: 403 });
    found = detectEnvKeys();
  } else ({ found, unrecognized } = detectKeys(p.data.text!));

  const deps = getDeps();
  const results = [];
  for (const k of found) {
    const r = await handleSaveKey(uid, { provider: k.provider, key: k.key }, deps);
    results.push({ provider: k.provider, name: getProvider(k.provider)?.name ?? k.provider, source: k.source, ok: r.status === 200, error: r.status === 200 ? null : String((r.body as { error?: string }).error ?? 'Failed') });
  }
  return Response.json({ results, unrecognized });
}
