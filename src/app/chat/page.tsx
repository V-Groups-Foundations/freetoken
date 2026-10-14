import Link from 'next/link';
import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listUserModels } from '@/router/models';
import { listChats, listChatMessages } from '@/chat/service';
import { Chat } from './chat';

export default async function ChatPage() {
  const uid = await requireUserId();
  const db = getDb();
  const [models, chatList] = await Promise.all([listUserModels(db, uid), listChats(db, uid)]);
  if (models.length === 0) {
    return (
      <div className="card card-pad">
        <h2 className="font-semibold">No providers connected</h2>
        <p className="muted mt-1 text-sm">
          Connect at least one provider to start chatting.{' '}
          <Link href="/connect" className="font-medium text-[var(--brand)] hover:underline">Connect providers</Link>
        </p>
      </div>
    );
  }
  const activeId = chatList[0]?.id ?? null;
  const initialMessages = activeId ? await listChatMessages(db, activeId) : [];
  return (
    <Chat
      models={models}
      initialChats={chatList.map((c) => ({ id: c.id, title: c.title }))}
      activeId={activeId}
      initialMessages={initialMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content, provider: m.provider ?? undefined }))}
    />
  );
}
