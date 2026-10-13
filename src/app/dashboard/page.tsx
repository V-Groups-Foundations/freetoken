import Link from 'next/link';
import { requireUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { getUsageSummary } from '@/usage/summary';
import { UsagePanel } from './usage-panel';

export default async function DashboardPage() {
  const uid = await requireUserId();
  const summary = await getUsageSummary(uid, getDeps());
  if (summary.providers.length === 0) {
    return (
      <p>
        Connect a provider to see your usage.{' '}
        <Link href="/connect" className="text-blue-700 underline">Connect providers</Link>
      </p>
    );
  }
  return <UsagePanel initial={summary} />;
}
