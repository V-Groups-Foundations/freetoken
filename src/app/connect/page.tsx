import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { PROVIDERS, toPublicProvider } from '@/providers/registry';
import { SERVICES, toPublicService } from '@/services/registry';
import { ProviderCard } from './provider-card';
import { ServiceCard } from './service-card';

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const uid = await requireUserId();
  const keyList = await listKeys(getDb(), uid);
  const keys = new Map(keyList.map((k) => [k.provider, k]));
  // Only count keys for providers still offered (an orphaned key from a removed provider must not inflate the tally).
  const offered = new Set<string>(PROVIDERS.map((p) => p.id));
  const connectedCount = keyList.filter((k) => k.status === 'valid' && offered.has(k.provider)).length;
  const { connected, error } = await searchParams;

  return (
    <section className="grid-bg relative space-y-8">
      <div className="aurora" aria-hidden />

      {/* Hero */}
      <header className="pt-2">
        <span className="eyebrow">every provider is free — no card, ever</span>
        <h1 className="h1 mt-2.5 max-w-2xl">Pool your free AI tiers into one key.</h1>
        <p className="lead mt-2 max-w-xl">
          Connect a provider below. Each hands out a free API key — the more you add, the more free quota FreeToken
          can route across. Keys are encrypted and used only for your own requests.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <div className="stat">
            <div className="text-2xl font-bold leading-none">{PROVIDERS.length}</div>
            <div className="muted mt-1 text-xs">free providers</div>
          </div>
          <div className="stat">
            <div className="grad-text text-2xl font-bold leading-none">{connectedCount}</div>
            <div className="muted mt-1 text-xs">connected</div>
          </div>
          <div className="stat">
            <div className="text-2xl font-bold leading-none">$0</div>
            <div className="muted mt-1 text-xs">cost to start</div>
          </div>
        </div>
      </header>

      {connected && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--brand-tint)] px-4 py-3 text-sm text-[var(--brand-ink)]">
          Connected {connected} successfully. 🎉
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--danger-tint)] px-4 py-3 text-sm text-[var(--danger)]">{error}</p>
      )}

      {/* Provider grid */}
      <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={toPublicProvider(p)} connected={keys.get(p.id) ?? null} oauth={p.id === 'openrouter'} />
        ))}
      </div>

      {/* Tools & services — non-chat free APIs that power the Web page, Tools, and more */}
      <div className="pt-2">
        <span className="eyebrow">tools &amp; services</span>
        <h2 className="h2 mt-2.5">Add free, non-chat superpowers.</h2>
        <p className="lead mt-2 max-w-xl">
          Connect a free key to unlock web search, better translation, and more. Each is optional — FreeToken works
          without them, and gets sharper with them.
        </p>
        <div className="mt-5 grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s) => (
            <ServiceCard key={s.id} service={toPublicService(s)} connected={keys.get(s.id) ?? null} />
          ))}
        </div>
      </div>
    </section>
  );
}
