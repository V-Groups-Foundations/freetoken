import { headers } from 'next/headers';
import { requireUserId } from '@/lib/session';
import { Tokens } from './tokens';

export default async function SettingsPage() {
  await requireUserId();
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const baseUrl = `${proto}://${h.get('host')}/api/v1`;
  return (
    <section className="space-y-6">
      <div>
        <h1 className="h2">Your API</h1>
        <p className="muted mt-1">Use FreeToken from any OpenAI-compatible tool — Cline, Continue, or your own scripts.</p>
      </div>
      <div className="card card-pad space-y-1.5 text-sm">
        <div>Base URL <code className="ml-1 rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">{baseUrl}</code></div>
        <div>Models <code className="ml-1 rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">auto-smart</code> <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">auto-fast</code> <span className="muted">or any from</span> <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">/models</code></div>
      </div>
      <Tokens />
    </section>
  );
}
