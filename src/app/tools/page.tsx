import Link from 'next/link';
import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listUserModels } from '@/router/models';
import { ToolsClient } from './tools';

export default async function ToolsPage() {
  const uid = await requireUserId();
  const models = await listUserModels(getDb(), uid);
  if (models.length === 0) {
    return (
      <div className="card card-pad">
        <h2 className="font-semibold">No providers connected</h2>
        <p className="muted mt-1 text-sm">
          These tools run on your chat models.{' '}
          <Link href="/connect" className="font-medium text-[var(--brand)] hover:underline">Connect a provider</Link> to use them.
        </p>
      </div>
    );
  }
  return <ToolsClient />;
}
