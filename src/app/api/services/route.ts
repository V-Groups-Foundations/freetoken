import { getDb } from '@/db';
import { removeKey } from '@/keys/service';
import { sessionUserId } from '@/lib/session';
import { handleSaveServiceKey } from '@/server/service-keys-handlers';
import { getDeps } from '@/server/deps';

const unauthorized = () => Response.json({ error: 'Sign in first.' }, { status: 401 });

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const r = await handleSaveServiceKey(uid, await req.json().catch(() => null), getDeps());
  return Response.json(r.body, { status: r.status });
}

export async function DELETE(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const service = new URL(req.url).searchParams.get('service');
  if (!service) return Response.json({ error: 'service is required.' }, { status: 400 });
  await removeKey(getDb(), uid, service);
  return Response.json({ ok: true });
}
