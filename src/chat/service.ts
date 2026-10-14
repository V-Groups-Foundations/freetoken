import { and, asc, desc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { chatMessages, chats } from '@/db/schema';

/** A short title derived from the first user message. */
export function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length <= 60 ? t : t.slice(0, 57) + '…';
}

export async function createChat(db: DB, userId: string, title = 'New chat', model = 'auto-smart') {
  const [c] = await db.insert(chats).values({ userId, title, model }).returning();
  return c;
}

export async function listChats(db: DB, userId: string) {
  return db
    .select({ id: chats.id, title: chats.title, model: chats.model, updatedAt: chats.updatedAt })
    .from(chats)
    .where(eq(chats.userId, userId))
    .orderBy(desc(chats.updatedAt));
}

export async function getChat(db: DB, userId: string, id: string) {
  const [c] = await db.select().from(chats).where(and(eq(chats.id, id), eq(chats.userId, userId)));
  return c ?? null;
}

export async function setChatModel(db: DB, userId: string, id: string, model: string) {
  await db.update(chats).set({ model, updatedAt: new Date() }).where(and(eq(chats.id, id), eq(chats.userId, userId)));
}

export async function renameChat(db: DB, userId: string, id: string, title: string) {
  await db.update(chats).set({ title }).where(and(eq(chats.id, id), eq(chats.userId, userId)));
}

export async function touchChat(db: DB, id: string) {
  await db.update(chats).set({ updatedAt: new Date() }).where(eq(chats.id, id));
}

export async function deleteChat(db: DB, userId: string, id: string) {
  await db.delete(chats).where(and(eq(chats.id, id), eq(chats.userId, userId)));
}

export async function listChatMessages(db: DB, chatId: string) {
  return db
    .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content, provider: chatMessages.provider })
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(asc(chatMessages.id));
}

export async function addChatMessage(
  db: DB,
  chatId: string,
  m: { role: 'user' | 'assistant'; content: string; provider?: string | null },
) {
  const [row] = await db.insert(chatMessages).values({ chatId, role: m.role, content: m.content, provider: m.provider ?? null }).returning();
  return row;
}
