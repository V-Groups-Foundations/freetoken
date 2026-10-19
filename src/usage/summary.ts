import { eq } from 'drizzle-orm';
import { models, providerKeys, providerLimits } from '@/db/schema';
import { getProvider } from '@/providers/registry';
import type { Credentials, FetchFn } from '@/providers/client';
import { loadCredentials } from '@/keys/service';
import { dayStart, monthStart, usageSince } from '@/usage/ledger';
import { usageKey } from '@/router/select';
import type { Deps } from '@/server/deps';

export interface ModelUsage {
  modelId: string;
  displayName: string;
  tier: string;
  requests: number;
  tokens: number;
  /** part of `tokens` that was guessed because the provider didn't report counts */
  estimatedTokens: number;
  limitRequests: number | null;
  remainingRequests: number | null;
  resetAt: string | null;
  /** provider = from the provider's rate-limit headers; estimate = FreeToken's catalog of published limits;
   *  shared = counts toward the provider's account-wide limit */
  source: 'provider' | 'estimate' | 'shared' | 'unknown';
  /** when the provider's numbers were last seen (live rows only) */
  asOf: string | null;
}

export interface AccountUsage {
  label: string;
  used: number;
  limit: number;
  remaining: number;
  period: 'day' | 'month';
  source: 'provider' | 'estimate';
  note: string;
}

export interface ProviderUsage {
  provider: string;
  name: string;
  excludedFromAuto: boolean;
  status: string;
  coolingUntil: Date | null;
  account: AccountUsage | null;
  /** why there's no daily number for this provider, when there isn't */
  limitNote: string | null;
  models: ModelUsage[];
}

export interface UsageSummary {
  today: { requests: number; tokens: number; estimatedTokens: number };
  /** when "today" began (00:00 UTC), so the UI can show it in local time */
  dayStartedAt: string;
  /** live + published (kept for older clients) */
  knownRemainingRequests: number;
  /** requests left as reported by the providers themselves */
  liveRemainingRequests: number;
  /** requests left by published limits FreeToken knows of, not confirmed by the provider */
  publishedRemainingRequests: number;
  providers: ProviderUsage[];
}

/**
 * Free tiers that cap the whole account rather than each model. Showing (and summing) the cap per
 * model would count the same allowance once per model.
 */
const SHARED_POOLS: Record<string, { label: string; limit: number; period: 'day' | 'month'; note: string }> = {
  openrouter: {
    label: 'Free-model requests today', limit: 50, period: 'day',
    note: 'One daily allowance shared by every :free model (1,000/day once the account has bought $10+ of credits). Resets 00:00 UTC.',
  },
  cohere: {
    label: 'Trial calls this month', limit: 1000, period: 'month',
    note: 'Trial keys get 1,000 calls a month shared by all models. Production keys are not capped this way.',
  },
};

/** OpenRouter reports free-model daily request usage on GET /key. */
async function openRouterAccount(creds: Credentials, fetchImpl: FetchFn): Promise<Pick<AccountUsage, 'used' | 'limit' | 'remaining'> | null> {
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/key', {
      headers: { authorization: `Bearer ${creds.key}` },
    });
    if (!res.ok) return null;
    const free = (await res.json())?.data?.free_model_daily_requests;
    if (!free || typeof free.remaining !== 'number') return null;
    return { used: free.used ?? 0, limit: free.limit ?? 0, remaining: free.remaining };
  } catch {
    return null;
  }
}

const keyRowsUse = (rows: { provider: string }[], period: 'day' | 'month') =>
  rows.some((r) => SHARED_POOLS[r.provider]?.period === period);

/** Providers that don't have (or don't report) a daily request count. */
const NO_DAILY_LIMIT: Record<string, string> = {
  nvidia: 'NVIDIA limits requests per minute (about 40/min), not per day — there is no daily count to show.',
  sambanova: 'SambaNova limits requests per minute, not per day — there is no daily count to show.',
  gemini: "Google sets Gemini's free limits per model and changes them often, and doesn't report them to apps — see AI Studio → Usage.",
  default: "This provider doesn't publish or report a daily limit, so only what you've used is shown.",
};

export async function getUsageSummary(userId: string, deps: Deps): Promise<UsageSummary> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const creds = await loadCredentials(deps.db, userId, deps.vaultKey);

  const keyRows = await deps.db
    .select({ provider: providerKeys.provider, status: providerKeys.status, excludedFromAuto: providerKeys.excludedFromAuto })
    .from(providerKeys)
    .where(eq(providerKeys.userId, userId));

  const catalog = await deps.db.select().from(models).where(eq(models.enabled, true));
  const nowMs = (deps.now ?? Date.now)();
  const started = dayStart(new Date(nowMs));
  const used = await usageSince(deps.db, userId, started);
  const usedMonth = keyRowsUse(keyRows, 'month') ? await usageSince(deps.db, userId, monthStart(new Date(nowMs))) : used;
  const limitRows = await deps.db.select().from(providerLimits).where(eq(providerLimits.userId, userId));
  const liveLimits = new Map(limitRows.map((r) => [usageKey(r.provider, r.modelId), r]));

  const today = { requests: 0, tokens: 0, estimatedTokens: 0 };
  for (const u of used.values()) {
    today.requests += u.requests;
    today.tokens += u.tokens;
    today.estimatedTokens += u.estimatedTokens;
  }

  let liveRemainingRequests = 0;
  let publishedRemainingRequests = 0;
  const providers: ProviderUsage[] = [];

  for (const key of keyRows) {
    const def = getProvider(key.provider);
    if (!def) continue;
    const cd = await deps.kv.get(`cd:${userId}:${key.provider}`);
    const coolingUntil = cd ? new Date(Number(cd)) : null;

    const pool = SHARED_POOLS[key.provider];
    const liveAccount =
      key.provider === 'openrouter' && creds.get('openrouter')
        ? await openRouterAccount(creds.get('openrouter')!.creds, fetchImpl)
        : null;
    let account: AccountUsage | null = null;
    if (pool) {
      const ledger = pool.period === 'month' ? usedMonth : used;
      const counted = catalog
        .filter((m) => m.provider === key.provider)
        .reduce((n, m) => n + (ledger.get(usageKey(m.provider, m.modelId))?.requests ?? 0), 0);
      account = liveAccount
        ? { label: pool.label, ...liveAccount, period: pool.period, source: 'provider', note: pool.note }
        : { label: pool.label, used: counted, limit: pool.limit, remaining: Math.max(0, pool.limit - counted), period: pool.period, source: 'estimate', note: pool.note };
      if (account.source === 'provider') liveRemainingRequests += account.remaining;
      else publishedRemainingRequests += account.remaining;
    }

    const modelUsages: ModelUsage[] = catalog
      .filter((m) => m.provider === key.provider)
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .map((m) => {
        const u = used.get(usageKey(m.provider, m.modelId)) ?? { requests: 0, tokens: 0, estimatedTokens: 0 };
        const live = liveLimits.get(usageKey(m.provider, m.modelId));
        let limitRequests: number | null = null;
        let remainingRequests: number | null = null;
        let resetAt: string | null = null;
        let asOf: string | null = null;
        let source: ModelUsage['source'] = 'unknown';
        if (pool) {
          source = 'shared';
        } else if (live && live.remainingRequests != null) {
          limitRequests = live.limitRequests;
          remainingRequests = live.remainingRequests;
          asOf = live.updatedAt.toISOString();
          const reset = live.requestsResetAt?.getTime();
          // The snapshot is from the last response. Once its reset time has passed the window has
          // refilled, so the old "remaining" would understate what's left.
          if (reset != null && reset <= nowMs && live.limitRequests != null) remainingRequests = live.limitRequests;
          else resetAt = reset != null ? new Date(reset).toISOString() : null;
          source = 'provider';
        } else if (m.rpd != null) {
          limitRequests = m.rpd;
          remainingRequests = Math.max(0, m.rpd - u.requests);
          source = 'estimate';
        }
        if (remainingRequests != null) {
          if (source === 'provider') liveRemainingRequests += remainingRequests;
          else publishedRemainingRequests += remainingRequests;
        }
        return {
          modelId: m.modelId,
          displayName: m.displayName,
          tier: m.tier,
          requests: u.requests,
          tokens: u.tokens,
          estimatedTokens: u.estimatedTokens,
          limitRequests,
          remainingRequests,
          resetAt,
          source,
          asOf,
        };
      });

    providers.push({
      provider: key.provider,
      name: def.name,
      excludedFromAuto: key.excludedFromAuto,
      status: key.status,
      coolingUntil,
      account,
      limitNote: !account && modelUsages.every((x) => x.limitRequests == null) ? (NO_DAILY_LIMIT[key.provider] ?? NO_DAILY_LIMIT.default) : null,
      models: modelUsages,
    });
  }

  return {
    today, dayStartedAt: started.toISOString(),
    knownRemainingRequests: liveRemainingRequests + publishedRemainingRequests, liveRemainingRequests, publishedRemainingRequests,
    providers,
  };
}
