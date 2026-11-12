import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { canViewCrashes, listCrashes } from '@/server/vrun-crashes';

export const dynamic = 'force-dynamic';

/** V-Run's crash reports, newest first — only for the accounts named in VRUN_CRASH_VIEWERS. */
export default async function CrashesPage() {
  const db = getDb();
  const uid = await requireUserId();
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, uid));
  if (!canViewCrashes(me?.email)) notFound();
  const rows = await listCrashes(db, 200);
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">V-Run crash reports</h1>
      <p className="muted text-sm">{rows.length ? `${rows.length} different problems, ${total} reports in all. The same problem in the same version is counted, not repeated.` : 'No reports yet.'}</p>
      {rows.map((r) => (
        <details key={r.id} className="card card-pad">
          <summary className="cursor-pointer">
            <span className="font-mono text-xs">{r.kind}</span> · <span className="font-medium">{r.message.slice(0, 160)}</span>
            <span className="muted text-sm"> — ×{r.count} · v{r.version} · {r.os} · last {r.lastSeen.toISOString().slice(0, 16).replace('T', ' ')} UTC</span>
          </summary>
          {r.stack && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{r.stack}</pre>}
        </details>
      ))}
    </main>
  );
}
