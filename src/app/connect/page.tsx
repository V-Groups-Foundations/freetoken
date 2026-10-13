import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { PROVIDERS, toPublicProvider } from '@/providers/registry';
import { ProviderCard } from './provider-card';

export default async function ConnectPage() {
  const uid = await requireUserId();
  const keys = new Map((await listKeys(getDb(), uid)).map((k) => [k.provider, k]));
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connect your providers</h1>
        <p className="text-neutral-600">
          Each provider gives you a free API key. The more you connect, the more free quota you get. Keys are
          encrypted, only used for your requests, and you can remove them at any time.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={toPublicProvider(p)} connected={keys.get(p.id) ?? null} />
        ))}
      </div>
    </section>
  );
}
