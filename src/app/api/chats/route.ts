import { z } from 'zod';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { createChat, listChats, titleFrom } from '@/chat/service';

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  return Response.json(await listChats(getDb(), uid));
}

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const p = z
    .object({ title: z.string().trim().max(200).optional(), model: z.string().min(1).max(100).optional() })
    .safeParse(await req.json().catch(() => ({})));
  const title = p.success && p.data.title ? titleFrom(p.data.title) : 'New chat';
  const model = p.success && p.data.model ? p.data.model : 'auto-smart';
  const chat = await createChat(getDb(), uid, title, model);
  return Response.json(chat, { status: 201 });
}
