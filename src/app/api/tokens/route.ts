import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { createToken, listTokens, revokeToken } from '@/server/tokens';

const unauthorized = () => Response.json({ error: 'Sign in first.' }, { status: 401 });

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  return Response.json(await listTokens(getDb(), uid));
}

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const p = z.object({ name: z.string().trim().min(1).max(50) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Give the token a name.' }, { status: 400 });
  return Response.json({ token: await createToken(getDb(), uid, p.data.name) });
}

export async function DELETE(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return unauthorized();
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id)) return Response.json({ error: 'id is required.' }, { status: 400 });
  await revokeToken(getDb(), uid, id);
  return Response.json({ ok: true });
}
