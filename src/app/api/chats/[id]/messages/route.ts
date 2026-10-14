import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { getChat, listChatMessages } from '@/chat/service';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const chat = await getChat(db, uid, id);
  if (!chat) return Response.json({ error: { message: 'Chat not found.' } }, { status: 404 });
  return Response.json(await listChatMessages(db, id));
}
