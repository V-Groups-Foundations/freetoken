import { eq } from 'drizzle-orm';
import { models, providerKeys, providerLimits } from '@/db/schema';
import { getProvider } from '@/providers/registry';
import type { Credentials, FetchFn } from '@/providers/client';
import { loadCredentials } from '@/keys/service';
import { usageToday } from '@/usage/ledger';
import { usageKey } from '@/router/select';
import type { Deps } from '@/server/deps';

export interface ModelUsage {
  modelId: string;
  displayName: string;
  tier: string;
  requests: number;
  tokens: number;
  limitRequests: number | null;
  remainingRequests: number | null;
  resetAt: string | null;
  source: 'provider' | 'estimate' | 'unknown';
}

export interface AccountUsage {
  label: string;
  used: number;
  limit: number;
  remaining: number;
}

export interface ProviderUsage {
  provider: string;
  name: string;
  excludedFromAuto: boolean;
  status: string;
  coolingUntil: Date | null;
  account: AccountUsage | null;
  models: ModelUsage[];
}

export interface UsageSummary {
  today: { requests: number; tokens: number };
  knownRemainingRequests: number;
  providers: ProviderUsage[];
}

/** OpenRouter reports free-model daily request usage on GET /key. */
async function openRouterAccount(creds: Credentials, fetchImpl: FetchFn): Promise<AccountUsage | null> {
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/key', {
      headers: { authorization: `Bearer ${creds.key}` },
    });
    if (!res.ok) return null;
    const free = (await res.json())?.data?.free_model_daily_requests;
    if (!free || typeof free.remaining !== 'number') return null;
    return { label: 'Free-model requests today', used: free.used ?? 0, limit: free.limit ?? 0, remaining: free.remaining };
  } catch {
    return null;
  }
}

export async function getUsageSummary(userId: string, deps: Deps): Promise<UsageSummary> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const creds = await loadCredentials(deps.db, userId, deps.vaultKey);

  const keyRows = await deps.db
    .select({ provider: providerKeys.provider, status: providerKeys.status, excludedFromAuto: providerKeys.excludedFromAuto })
    .from(providerKeys)
    .where(eq(providerKeys.userId, userId));

  const catalog = await deps.db.select().from(models).where(eq(models.enabled, true));
  const used = await usageToday(deps.db, userId, new Date((deps.now ?? Date.now)()));
  const limitRows = await deps.db.select().from(providerLimits).where(eq(providerLimits.userId, userId));
  const liveLimits = new Map(limitRows.map((r) => [usageKey(r.provider, r.modelId), r]));

  const today = { requests: 0, tokens: 0 };
  for (const u of used.values()) {
    today.requests += u.requests;
    today.tokens += u.tokens;
  }

  let knownRemainingRequests = 0;
  const providers: ProviderUsage[] = [];

  for (const key of keyRows) {
    const def = getProvider(key.provider);
    if (!def) continue;
    const cd = await deps.kv.get(`cd:${userId}:${key.provider}`);
    const coolingUntil = cd ? new Date(Number(cd)) : null;

    const account =
      key.provider === 'openrouter' && creds.get('openrouter')
        ? await openRouterAccount(creds.get('openrouter')!.creds, fetchImpl)
        : null;

    const modelUsages: ModelUsage[] = catalog
      .filter((m) => m.provider === key.provider)
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .map((m) => {
        const u = used.get(usageKey(m.provider, m.modelId)) ?? { requests: 0, tokens: 0 };
        const live = liveLimits.get(usageKey(m.provider, m.modelId));
        let limitRequests: number | null = null;
        let remainingRequests: number | null = null;
        let resetAt: string | null = null;
        let source: ModelUsage['source'] = 'unknown';
        if (live && live.remainingRequests != null) {
          limitRequests = live.limitRequests;
          remainingRequests = live.remainingRequests;
          resetAt = live.requestsResetAt ? live.requestsResetAt.toISOString() : null;
          source = 'provider';
        } else if (m.rpd != null) {
          limitRequests = m.rpd;
          remainingRequests = Math.max(0, m.rpd - u.requests);
          source = 'estimate';
        }
        if (remainingRequests != null) knownRemainingRequests += remainingRequests;
        return {
          modelId: m.modelId,
          displayName: m.displayName,
          tier: m.tier,
          requests: u.requests,
          tokens: u.tokens,
          limitRequests,
          remainingRequests,
          resetAt,
          source,
        };
      });

    providers.push({
      provider: key.provider,
      name: def.name,
      excludedFromAuto: key.excludedFromAuto,
      status: key.status,
      coolingUntil,
      account,
      models: modelUsages,
    });
  }

  return { today, knownRemainingRequests, providers };
}
