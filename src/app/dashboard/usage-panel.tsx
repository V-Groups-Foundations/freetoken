'use client';

import { useEffect, useState } from 'react';
import type { UsageSummary, ProviderUsage, ModelUsage } from '@/usage/summary';
import { PageHeader } from '../page-header';

/** "4 hr 12 min", "38 min", "less than a minute" until `iso`; empty when unknown, past, or before mount. */
function countdown(iso: string | null, now: number): string {
  if (!iso || !now) return '';
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return '';
  const mins = Math.ceil(ms / 60000);
  if (mins < 1) return 'less than a minute';
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d) return `${d} day${d > 1 ? 's' : ''}${h ? ` ${h} hr` : ''}`;
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`;
}

/** Clock time in the viewer's zone; empty until mounted so server and client markup match. */
function clock(iso: string | null, now: number): string {
  return iso && now ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

const PERIOD: Record<string, string> = { day: 'per day', month: 'per month', minute: 'per minute', window: 'rolling limit' };

/** When this allowance starts over, in words: "Resets in 4 hr 12 min (5:30 AM)", "Resets Nov 1". */
function resetLine(period: string | null, resetAt: string | null, now: number, live = false): string {
  if (!now) return '';
  const left = countdown(resetAt, now);
  if (!left) return period === 'day' || period === 'month' ? '' : 'Refills as you go';
  // a provider-reported window (e.g. Groq's daily allowance) refills gradually rather than all at midnight
  if (live && period !== 'month') return `Back to full in ${left}`;
  if (period === 'month') return `Resets ${new Date(resetAt!).toLocaleDateString([], { month: 'short', day: 'numeric' })} (in ${left})`;
  if (period === 'day') return `Resets in ${left} (${clock(resetAt, now)})`;
  return `Refills in ${left}`;
}

/** How much is left, in words: what the meter's colour says, without a count to read. */
function standing(ratio: number): string {
  if (ratio >= 1) return 'Limit reached';
  if (ratio >= 0.9) return 'Almost used up';
  if (ratio >= 0.7) return 'Running low';
  return 'Plenty left';
}

/** Claude-style meter: "% used" on the right, the bar, then how much is left in words and when it resets.
 * The counts behind it are in each card's "Numbers". */
function Meter({ label, used, limit, period, resetAt, note, now, live }: {
  label: React.ReactNode; used: number; limit: number; period: string | null; resetAt: string | null; note?: string; now: number; live?: boolean;
}) {
  const ratio = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  const pct = Math.round(ratio * 100);
  // plenty left: brand gradient; getting low: amber; nearly spent: red
  const fill = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : 'var(--grad)';
  const reset = resetLine(period, resetAt, now, live);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate">{label}{period && <span className="text-xs text-[var(--faint)]"> · {PERIOD[period] ?? period}</span>}</span>
        <span className="shrink-0 font-medium tabular-nums">{pct}% used</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% used`}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${used > 0 ? Math.max(2, ratio * 100) : 0}%`, background: fill }} />
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-[var(--faint)]">
        <span>{standing(ratio)}{note ? ` · ${note}` : ''}</span>
        {reset && <span className="tabular-nums">{reset}</span>}
      </div>
    </div>
  );
}

function sourceNote(m: ModelUsage, now: number): string {
  if (m.source === 'estimate') return 'published limit, not reported live';
  if (m.source === 'shared') return 'counts toward the shared limit';
  if (m.source !== 'provider') return '';
  // a live number goes stale between requests; say when it was read
  const age = m.asOf && now ? now - new Date(m.asOf).getTime() : 0;
  return age > 5 * 60_000 ? `live, as of ${clock(m.asOf, now)}` : 'live';
}

/** "37%", or "under 1%" — never "0%" next to a number marked as partly estimated. */
function estimatedShare(estimated: number, total: number) {
  const pct = (estimated / Math.max(1, total)) * 100;
  return pct < 1 ? 'under 1%' : `${Math.round(pct)}%`;
}

/** "1,234 tokens", or "≈1,234 tokens" when some of it was guessed (the provider didn't report counts). */
function tokensText(tokens: number, estimated: number) {
  return `${estimated > 0 ? '≈' : ''}${tokens.toLocaleString()} tokens`;
}

function ModelRow({ m, now }: { m: ModelUsage; now: number }) {
  const known = m.limitRequests != null && m.remainingRequests != null;
  const name = <>{m.displayName} <span className="text-xs text-[var(--faint)]">{m.tier}</span></>;
  return (
    <div className="space-y-1 py-2.5">
      {known ? (
        <Meter label={name} used={m.limitRequests! - m.remainingRequests!} limit={m.limitRequests!} period={m.period} resetAt={m.resetAt} now={now} live={m.source === 'provider'} />
      ) : (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate">{name}</span>
          {m.limitedAt
            ? <span className="shrink-0 text-amber-500">limit hit</span>
            : <span className="shrink-0 text-[var(--muted)]">{m.requests > 0 ? 'used today' : 'not used today'}</span>}
        </div>
      )}
      <div className="text-xs text-[var(--faint)]">
        {[m.limitedAt && `last try refused by its rate limit${clock(m.limitedAt, now) ? ` at ${clock(m.limitedAt, now)}` : ''}`, sourceNote(m, now), !known && m.source !== 'shared' && (m.rpm ? `limit about ${m.rpm}/min, no daily cap known` : 'no limit published')]
          .filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

/** The counts behind a provider's meters, folded away: what you used and what's left, per model. */
function ProviderNumbers({ p }: { p: ProviderUsage }) {
  const cell = 'py-1 pl-3 text-right tabular-nums';
  return (
    <details className="text-xs text-[var(--faint)]">
      <summary className="cursor-pointer select-none">Numbers</summary>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-left"><th className="py-1 font-medium">Today</th><th className={`${cell} font-medium`}>Requests</th><th className={`${cell} font-medium`}>Tokens</th><th className={`${cell} font-medium`}>Left</th></tr>
        </thead>
        <tbody>
          {p.account && (
            <tr><td className="py-1">{p.account.label}</td><td className={cell}>{p.account.used.toLocaleString()}</td><td className={cell}>—</td>
              <td className={cell}>{p.account.remaining.toLocaleString()} of {p.account.limit.toLocaleString()}</td></tr>
          )}
          {p.models.map((m) => (
            <tr key={m.modelId}>
              <td className="py-1">{m.displayName}</td>
              <td className={cell}>{m.requests.toLocaleString()}{m.attempts > m.requests && <> (+{(m.attempts - m.requests).toLocaleString()} failed)</>}</td>
              <td className={cell}>{tokensText(m.tokens, m.estimatedTokens).replace(' tokens', '')}</td>
              <td className={cell}>{m.limitRequests != null && m.remainingRequests != null ? `${m.remainingRequests.toLocaleString()} of ${m.limitRequests.toLocaleString()}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
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
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/40 p-3">
          <Meter label={<>{p.account.label}{p.account.source === 'estimate' && <span className="text-xs text-[var(--faint)]"> · counted by FreeToken</span>}</>}
            used={p.account.used} limit={p.account.limit} period={p.account.period} resetAt={p.account.resetAt} now={now} />
          <div className="text-xs text-[var(--faint)]">{p.account.note}</div>
        </div>
      )}
      {p.limitNote && <p className="text-xs text-[var(--faint)]">{p.limitNote}</p>}
      <div className="divide-y divide-[var(--border)]">
        {p.models.map((m) => <ModelRow key={m.modelId} m={m} now={now} />)}
      </div>
      <ProviderNumbers p={p} />
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
        subtitle="How much of your free allowance is used, and when it comes back."
        actions={
          <button onClick={() => void refresh()} disabled={refreshing} className="btn btn-secondary btn-sm">
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      {data.overall.limit > 0 ? (
        <div className="card card-pad neon-frame space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="eyebrow">overall</div>
              <h2 className="h2 mt-1.5">Your free capacity today</h2>
            </div>
            <div className="text-right">
              <div className="text-3xl font-semibold tracking-tight tabular-nums">{Math.round((data.overall.used / data.overall.limit) * 100)}%</div>
              <div className="faint text-xs">used today</div>
            </div>
          </div>
          <Meter label={<>{data.overall.limits} daily limit{data.overall.limits > 1 ? 's' : ''} combined</>}
            used={data.overall.used} limit={data.overall.limit} period="day" resetAt={data.overall.resetAt} now={now} />
          <p className="faint text-xs">
            {data.overall.live} of {data.overall.limits} reported live by the providers, the rest from published limits.
            Shared allowances are counted once; monthly and per-minute limits (and providers with no daily cap) aren&apos;t included.
          </p>
        </div>
      ) : (
        <div className="card card-pad">
          <h2 className="font-semibold">Your free capacity today</h2>
          <p className="faint mt-1 text-sm">None of your connected providers has a daily limit FreeToken knows, so there&apos;s no overall meter — each provider below shows what it can.</p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {data.providers.map((p) => <ProviderCard key={p.provider} p={p} now={now} />)}
      </div>
      <details className="card card-pad">
        <summary className="cursor-pointer select-none text-sm font-medium">Numbers</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="card card-pad">
            <div className="faint text-xs font-medium">Requests today</div>
            <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{data.today.requests.toLocaleString()}</div>
            <div className="faint text-xs">
              successful, since {clock(data.dayStartedAt, now) || 'midnight UTC'}
              {now > 0 && <> · new day in {countdown(new Date(new Date(data.dayStartedAt).getTime() + 86_400_000).toISOString(), now)}</>}
            </div>
          </div>
          <div className="card card-pad">
            <div className="faint text-xs font-medium">Tokens today</div>
            <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{data.today.estimatedTokens > 0 ? '≈ ' : ''}{data.today.tokens.toLocaleString()}</div>
            <div className="faint text-xs">
              {data.today.estimatedTokens > 0
                ? `prompt + completion · ${estimatedShare(data.today.estimatedTokens, data.today.tokens)} estimated (the provider didn't report counts)`
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
      </details>
    </section>
  );
}
