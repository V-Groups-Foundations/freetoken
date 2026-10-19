'use client';

import { useEffect, useState } from 'react';
import type { UsageSummary, ProviderUsage, ModelUsage } from '@/usage/summary';
import { PageHeader } from '../page-header';

function relReset(iso: string | null, now: number): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return `resets in ${m}m`;
  return `resets in ${Math.round(m / 60)}h`;
}

/** Clock time in the viewer's zone; empty until mounted so server and client markup match. */
function clock(iso: string | null, now: number): string {
  return iso && now ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

function sourceNote(m: ModelUsage, now: number): string {
  if (m.source === 'estimate') return ' · published limit, not reported live';
  if (m.source === 'shared') return ' · counts toward the shared limit';
  if (m.source !== 'provider') return '';
  // a live number goes stale between requests; say when it was read
  const age = m.asOf && now ? now - new Date(m.asOf).getTime() : 0;
  return age > 5 * 60_000 ? ` · live, as of ${clock(m.asOf, now)}` : ' · live';
}

/** "1,234 tokens", or "≈1,234 tokens" when some of it was guessed (the provider didn't report counts). */
function tokensText(tokens: number, estimated: number) {
  return `${estimated > 0 ? '≈' : ''}${tokens.toLocaleString()} tokens`;
}

function Bar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  // Fuel gauge: green with headroom, amber getting low, red nearly spent.
  const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function ModelRow({ m, now }: { m: ModelUsage; now: number }) {
  const known = m.limitRequests != null && m.remainingRequests != null;
  return (
    <div className="space-y-1 py-2">
      <div className="flex items-baseline justify-between text-sm">
        <span>{m.displayName} <span className="text-xs text-[var(--faint)]">{m.tier}</span></span>
        <span className="tabular-nums text-[var(--muted)]">
          {known
            ? <>{m.remainingRequests!.toLocaleString()} / {m.limitRequests!.toLocaleString()} left</>
            : <>{m.requests.toLocaleString()} used today</>}
        </span>
      </div>
      {known && <Bar used={m.limitRequests! - m.remainingRequests!} limit={m.limitRequests!} />}
      <div className="flex justify-between text-xs text-[var(--faint)]">
        <span>{tokensText(m.tokens, m.estimatedTokens)} today{sourceNote(m, now)}</span>
        <span>{relReset(m.resetAt, now)}</span>
      </div>
    </div>
  );
}

function ProviderCard({ p, now }: { p: ProviderUsage; now: number }) {
  const cooling = p.coolingUntil && new Date(p.coolingUntil).getTime() > now;
  return (
    <div className="card card-pad space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{p.name}</h2>
        <div className="flex gap-2">
          {p.status !== 'valid' && <span className="badge badge-bad">key rejected</span>}
          {p.excludedFromAuto && <span className="badge badge-off">excluded from auto</span>}
          {cooling && <span className="badge badge-warn">cooling down</span>}
          {p.status === 'valid' && !p.excludedFromAuto && !cooling && (
            <span className="badge badge-ok"><span className="inline-block h-1.5 w-1.5 rounded-full bg-current" /> ready</span>
          )}
        </div>
      </div>
      {p.account && (
        <div className="space-y-1 rounded bg-[var(--surface-2)] p-2 text-sm">
          <div className="flex justify-between">
            <span>{p.account.label}{p.account.source === 'estimate' && <span className="text-xs text-[var(--faint)]"> · estimated</span>}</span>
            <span className="tabular-nums">{p.account.remaining.toLocaleString()} / {p.account.limit.toLocaleString()} left</span>
          </div>
          <Bar used={p.account.used} limit={p.account.limit} />
          <div className="text-xs text-[var(--faint)]">{p.account.note}</div>
        </div>
      )}
      {p.limitNote && <p className="text-xs text-[var(--faint)]">{p.limitNote}</p>}
      <div className="divide-y divide-[var(--border)]">
        {p.models.map((m) => <ModelRow key={m.modelId} m={m} now={now} />)}
      </div>
    </div>
  );
}

export function UsagePanel({ initial }: { initial: UsageSummary }) {
  const [data, setData] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  // Set after mount so server and client render the same markup (no Date.now() during render).
  const [now, setNow] = useState(0);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/usage');
      if (res.ok) setData(await res.json());
    } finally {
      setRefreshing(false);
    }
  }

  // Auto-refresh every 20s so numbers track real usage without a reload.
  // The timer defers the first setNow so it isn't a synchronous setState in the effect.
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  return (
    <section className="space-y-6">
      <PageHeader
        title="Usage"
        subtitle="Live free-tier quota across your connected providers."
        actions={
          <button onClick={() => void refresh()} disabled={refreshing} className="btn btn-secondary btn-sm">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card card-pad">
          <div className="faint text-xs font-medium">Requests today</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{data.today.requests.toLocaleString()}</div>
          <div className="faint text-xs">successful, since {clock(data.dayStartedAt, now) || 'midnight UTC'}</div>
        </div>
        <div className="card card-pad">
          <div className="faint text-xs font-medium">Tokens today</div>
          <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{data.today.estimatedTokens > 0 ? '≈ ' : ''}{data.today.tokens.toLocaleString()}</div>
          <div className="faint text-xs">
            {data.today.estimatedTokens > 0
              ? `prompt + completion · ${Math.round((data.today.estimatedTokens / Math.max(1, data.today.tokens)) * 100)}% estimated (the provider didn't report counts)`
              : 'prompt + completion, as reported by the providers'}
          </div>
        </div>
        <div className="card card-pad">
          <div className="faint text-xs font-medium">Free requests left</div>
          {data.liveRemainingRequests > 0 ? (
            <>
              <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{data.liveRemainingRequests.toLocaleString()}</div>
              <div className="faint text-xs">
                reported by the providers
                {data.publishedRemainingRequests > 0 && <> · plus ≈{data.publishedRemainingRequests.toLocaleString()} by published limits</>}
                {' '}· per-minute-only providers not counted
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">≈ {data.publishedRemainingRequests.toLocaleString()}</div>
              <div className="faint text-xs">by published limits — no provider has reported live numbers yet · per-minute-only providers not counted</div>
            </>
          )}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {data.providers.map((p) => <ProviderCard key={p.provider} p={p} now={now} />)}
      </div>
    </section>
  );
}
