import Link from 'next/link';
import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listUserModels } from '@/router/models';
import { StudioClient } from './studio';

export default async function StudioPage() {
  const uid = await requireUserId();
  const models = await listUserModels(getDb(), uid);
  if (models.length === 0) {
    return (
      <div className="card card-pad">
        <h2 className="font-semibold">No providers connected</h2>
        <p className="muted mt-1 text-sm">
          The studio builds mini-apps with your chat models.{' '}
          <Link href="/connect" className="font-medium text-[var(--brand)] hover:underline">Connect a provider</Link> to start.
        </p>
      </div>
    );
  }
  return <StudioClient />;
}
