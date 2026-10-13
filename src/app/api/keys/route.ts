import { z } from 'zod';
import { getDb } from '@/db';
import { listKeys, removeKey, setExcluded } from '@/keys/service';
import { sessionUserId } from '@/lib/session';
import { handleSaveKey } from '@/server/keys-handlers';
import { getDeps } from '@/server/deps';

const unauthorized = () => Response.json({ error: 'Sign in first.' }, { status: 401 });

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  return Response.json(await listKeys(getDb(), uid));
}

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const r = await handleSaveKey(uid, await req.json().catch(() => null), getDeps());
  return Response.json(r.body, { status: r.status });
}

export async function PATCH(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const p = z.object({ provider: z.string(), excludedFromAuto: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Invalid input.' }, { status: 400 });
  await setExcluded(getDb(), uid, p.data.provider, p.data.excludedFromAuto);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const provider = new URL(req.url).searchParams.get('provider');
  if (!provider) return Response.json({ error: 'provider is required.' }, { status: 400 });
  await removeKey(getDb(), uid, provider);
  return Response.json({ ok: true });
}
