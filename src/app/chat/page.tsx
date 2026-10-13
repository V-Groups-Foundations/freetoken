import Link from 'next/link';
import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listUserModels } from '@/router/models';
import { Chat } from './chat';

export default async function ChatPage() {
  const uid = await requireUserId();
  const models = await listUserModels(getDb(), uid);
  if (models.length === 0) {
    return (
      <p>
        Connect at least one provider first. <Link href="/connect" className="text-blue-700 underline">Connect providers</Link>
      </p>
    );
  }
  return <Chat models={models} />;
}
