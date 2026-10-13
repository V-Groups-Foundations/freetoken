import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { PROVIDERS, toPublicProvider } from '@/providers/registry';
import { ProviderCard } from './provider-card';

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const uid = await requireUserId();
  const keys = new Map((await listKeys(getDb(), uid)).map((k) => [k.provider, k]));
  const { connected, error } = await searchParams;
  return (
    <section className="space-y-6">
      <div>
        <h1 className="h2">Connect your providers</h1>
        <p className="muted mt-1 max-w-2xl">
          Each provider gives you a free API key. The more you connect, the more free quota you get. Keys are
          encrypted, only used for your requests, and you can remove them any time.
        </p>
      </div>
      {connected && (
        <p className="rounded-xl bg-[#e3f4ec] px-4 py-3 text-sm text-[#15724a]">Connected {connected} successfully.</p>
      )}
      {error && <p className="rounded-xl bg-[#fbe9e5] px-4 py-3 text-sm text-[var(--danger)]">{error}</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={toPublicProvider(p)} connected={keys.get(p.id) ?? null} oauth={p.id === 'openrouter'} />
        ))}
      </div>
    </section>
  );
}
