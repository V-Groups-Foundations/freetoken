import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { deleteChat, renameChat, setChatModel } from '@/chat/service';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  const p = z
    .object({ model: z.string().min(1).max(100).optional(), title: z.string().trim().min(1).max(200).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Invalid request.' }, { status: 400 });
  const db = getDb();
  if (p.data.model) await setChatModel(db, uid, id, p.data.model);
  if (p.data.title) await renameChat(db, uid, id, p.data.title);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  await deleteChat(getDb(), uid, id);
  return Response.json({ ok: true });
}
