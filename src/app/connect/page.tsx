import Link from 'next/link';
import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { PROVIDERS, starterEnabled, toPublicProvider } from '@/providers/registry';
import { SERVICES, toPublicService } from '@/services/registry';
import { ProviderCard } from './provider-card';
import { getDeps } from '@/server/deps';
import { netStatus, unreachableHint } from '@/providers/network';
import { QuickConnect } from './quick-connect';
import { ServiceCard } from './service-card';

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; welcome?: string }>;
}) {
  const uid = await requireUserId();
  const keyList = await listKeys(getDb(), uid);
  const keys = new Map(keyList.map((k) => [k.provider, k]));
  // Only count keys for providers still offered (an orphaned key from a removed provider must not inflate the tally).
  const offered = new Set<string>(PROVIDERS.map((p) => p.id));
  const connectedCount = keyList.filter((k) => k.status === 'valid' && offered.has(k.provider)).length;
  const { connected, error, welcome } = await searchParams;
  const connectedIds = keyList.filter((k) => k.status === 'valid').map((k) => k.provider);
  // providers the user's last requests couldn't reach (restricted Wi-Fi?) — remembered for 30 minutes
  const kv = getDeps().kv;
  const unreachable = new Map((await Promise.all(PROVIDERS.map(async (p) => [p.id, await netStatus(kv, uid, p.id)] as const)))
    .filter(([, s]) => s).map(([id, s]) => [id, `${s!.message.replace(/^./, (c) => c.toUpperCase())}. ${unreachableHint([id]).replace(/^.*? couldn't be reached from this network\. /, '')}`]));

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

      <QuickConnect welcome={welcome === '1'} starterOn={starterEnabled()} connected={connectedIds} />

      {/* the tools people already use, on this pool */}
      <div className="neon-frame card card-pad flex flex-wrap items-center justify-between gap-5">
        <div className="max-w-xl space-y-1.5">
          <span className="eyebrow">use it everywhere</span>
          <h2 className="h2">Claude Code, Cursor &amp; Cline — on your free pool</h2>
          <p className="muted text-sm">
            FreeToken speaks the OpenAI and the Anthropic API, so your AI coding tools run on the keys you connect here.
            Connect one with a single click — FreeToken sets it up for you; for Claude Code you then just type <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">claude-free</code>.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {['Claude Code', 'Cursor', 'Cline', 'Continue', 'Aider', 'Codex', 'OpenCode'].map((t) => (
              <span key={t} className="badge badge-off">{t}</span>
            ))}
          </div>
        </div>
        <Link href="/settings#tools" className="btn btn-primary">Connect a tool — 1 click →</Link>
      </div>

      {/* Provider grid */}
      <div className="pt-2">
        <span className="eyebrow">every provider</span>
        <h2 className="h2 mt-2.5">All free providers</h2>
      </div>
      <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={toPublicProvider(p)} connected={keys.get(p.id) ?? null} oauth={p.id === 'openrouter'} unreachable={unreachable.get(p.id) ?? null} />
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
