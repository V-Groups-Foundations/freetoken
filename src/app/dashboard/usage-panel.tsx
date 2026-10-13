'use client';

import { useEffect, useState } from 'react';
import type { UsageSummary, ProviderUsage, ModelUsage } from '@/usage/summary';

function relReset(iso: string | null, now: number): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return 'resetting';
  const m = Math.round(ms / 60000);
  if (m < 60) return `resets in ${m}m`;
  return `resets in ${Math.round(m / 60)}h`;
}

function Bar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="h-1.5 w-full rounded bg-neutral-200">
      <div className={`h-1.5 rounded ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function ModelRow({ m, now }: { m: ModelUsage; now: number }) {
  const known = m.limitRequests != null && m.remainingRequests != null;
  return (
    <div className="space-y-1 py-2">
      <div className="flex items-baseline justify-between text-sm">
        <span>{m.displayName} <span className="text-xs text-neutral-400">{m.tier}</span></span>
        <span className="tabular-nums text-neutral-600">
          {known
            ? <>{m.remainingRequests!.toLocaleString()} / {m.limitRequests!.toLocaleString()} left</>
            : <>{m.requests.toLocaleString()} used today</>}
        </span>
      </div>
      {known && <Bar used={m.limitRequests! - m.remainingRequests!} limit={m.limitRequests!} />}
      <div className="flex justify-between text-xs text-neutral-400">
        <span>{m.tokens.toLocaleString()} tokens today{m.source === 'estimate' ? ' · estimated' : m.source === 'provider' ? ' · live' : ''}</span>
        <span>{relReset(m.resetAt, now)}</span>
      </div>
    </div>
  );
}

function ProviderCard({ p, now }: { p: ProviderUsage; now: number }) {
  const cooling = p.coolingUntil && new Date(p.coolingUntil).getTime() > now;
  return (
    <div className="space-y-2 rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{p.name}</h2>
        <div className="flex gap-2 text-xs">
          {p.status !== 'valid' && <span className="rounded bg-red-100 px-2 py-0.5 text-red-800">key rejected</span>}
          {p.excludedFromAuto && <span className="rounded bg-neutral-100 px-2 py-0.5 text-neutral-600">excluded from auto</span>}
          {cooling && <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">cooling down</span>}
        </div>
      </div>
      {p.account && (
        <div className="space-y-1 rounded bg-neutral-50 p-2 text-sm">
          <div className="flex justify-between">
            <span>{p.account.label}</span>
            <span className="tabular-nums">{p.account.remaining.toLocaleString()} / {p.account.limit.toLocaleString()} left</span>
          </div>
          <Bar used={p.account.used} limit={p.account.limit} />
        </div>
      )}
      <div className="divide-y">
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Usage</h1>
        <button onClick={() => void refresh()} disabled={refreshing} className="rounded border px-3 py-1 text-sm disabled:opacity-40">
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs uppercase text-neutral-400">Requests today</div>
          <div className="text-3xl font-semibold tabular-nums">{data.today.requests.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs uppercase text-neutral-400">Tokens today</div>
          <div className="text-3xl font-semibold tabular-nums">{data.today.tokens.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs uppercase text-neutral-400">Free requests left</div>
          <div className="text-3xl font-semibold tabular-nums">≈ {data.knownRemainingRequests.toLocaleString()}</div>
          <div className="text-xs text-neutral-400">across models with known limits</div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {data.providers.map((p) => <ProviderCard key={p.provider} p={p} now={now} />)}
      </div>
    </section>
  );
}
