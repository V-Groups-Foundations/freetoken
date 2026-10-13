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
        <h1 className="text-2xl font-semibold">Your API</h1>
        <p className="text-neutral-600">Use FreeToken from any OpenAI-compatible tool (Cline, Continue, scripts).</p>
      </div>
      <div className="space-y-1 rounded-xl border bg-white p-4 text-sm">
        <div>Base URL: <code className="rounded bg-neutral-100 px-1">{baseUrl}</code></div>
        <div>Models: <code className="rounded bg-neutral-100 px-1">auto-smart</code>, <code className="rounded bg-neutral-100 px-1">auto-fast</code>, or any from <code className="rounded bg-neutral-100 px-1">/models</code></div>
      </div>
      <Tokens />
    </section>
  );
}
