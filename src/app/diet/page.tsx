import Link from 'next/link';
import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listUserModels } from '@/router/models';
import { PageHeader } from '../page-header';
import { Diet } from './diet';

export default async function DietPage() {
  const uid = await requireUserId();
  const models = await listUserModels(getDb(), uid);
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Diet coach" title="Diet" subtitle="Tell the coach what you eat — it logs calories and macros, keeps your targets and plans what's left." />
      {models.length === 0 ? (
        <div className="card card-pad">
          <h2 className="font-semibold">No providers connected</h2>
          <p className="muted mt-1 text-sm">
            The coach runs on your free models.{' '}
            <Link href="/connect" className="font-medium text-[var(--brand)] hover:underline">Connect providers</Link>
          </p>
        </div>
      ) : <Diet />}
    </div>
  );
}
