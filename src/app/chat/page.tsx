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
      <div className="card card-pad">
        <h2 className="font-semibold">No providers connected</h2>
        <p className="muted mt-1 text-sm">
          Connect at least one provider to start chatting.{' '}
          <Link href="/connect" className="font-medium text-[var(--brand)] hover:underline">Connect providers</Link>
        </p>
      </div>
    );
  }
  return <Chat models={models} />;
}
