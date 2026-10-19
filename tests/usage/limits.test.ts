import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY, seedTestModels } from '../helpers/fixtures';
import { fakeFetch } from '../helpers/fake-fetch';
import type { DB } from '@/db';
import { createMemoryKV } from '@/lib/kv';
import { saveKey } from '@/keys/service';
import { parseDuration, parseRateHeaders, saveLimits } from '@/usage/limits';
import { recordUsage } from '@/usage/ledger';
import { getUsageSummary } from '@/usage/summary';

describe('parseDuration', () => {
  it('parses Groq-style and plain durations', () => {
    expect(parseDuration('2m59.56s')).toBe(179560);
    expect(parseDuration('7.66s')).toBe(7660);
    expect(parseDuration('1h2m3s')).toBe(3723000);
    expect(parseDuration('12')).toBe(12000);
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration(null)).toBeNull();
  });
});

describe('parseRateHeaders', () => {
  it('reads x-ratelimit-* headers', () => {
    const h = new Headers({
      'x-ratelimit-limit-requests': '1000',
      'x-ratelimit-remaining-requests': '990',
      'x-ratelimit-reset-requests': '1m0s',
      'x-ratelimit-limit-tokens': '6000',
      'x-ratelimit-remaining-tokens': '5800',
      'x-ratelimit-reset-tokens': '2s',
    });
    expect(parseRateHeaders(h, 1_000)).toEqual({
      limitRequests: 1000, remainingRequests: 990, requestsResetAt: new Date(61_000),
      limitTokens: 6000, remainingTokens: 5800, tokensResetAt: new Date(3_000),
    });
  });
  it('returns null when a provider sends none', () => {
    expect(parseRateHeaders(new Headers({ 'content-type': 'application/json' }))).toBeNull();
  });
});

describe('getUsageSummary', () => {
  let db: DB;
  let userId: string;
  beforeEach(async () => {
    db = await createTestDb();
    await seedTestModels(db);
    userId = (await createUser(db)).id;
  });
  const deps = (fetchImpl = fakeFetch(() => new Response('{}', { status: 500 })).fn) =>
    ({ db, kv: createMemoryKV(), vaultKey: TEST_VAULT_KEY, fetchImpl });

  it('combines ledger usage, catalog limits and live provider numbers', async () => {
    await saveKey(db, userId, 'groq', 'gsk_mine', null, TEST_VAULT_KEY);
    await saveKey(db, userId, 'gemini', 'AIza_mine', null, TEST_VAULT_KEY);
    const ev = { userId, source: 'chat' as const, promptTokens: 30, completionTokens: 10, latencyMs: 1, status: 'ok' as const };
    await recordUsage(db, { ...ev, provider: 'groq', modelId: 'llama-70b' });
    await recordUsage(db, { ...ev, provider: 'gemini', modelId: 'flash' });
    await saveLimits(db, userId, 'groq', 'llama-70b', {
      limitRequests: 1000, remainingRequests: 999, requestsResetAt: null,
      limitTokens: null, remainingTokens: null, tokensResetAt: null,
    });

    const s = await getUsageSummary(userId, deps());
    expect(s.today).toEqual({ requests: 2, tokens: 80 });
    const groq = s.providers.find((p) => p.provider === 'groq')!;
    const live = groq.models.find((m) => m.modelId === 'llama-70b')!;
    expect(live).toMatchObject({ requests: 1, tokens: 40, remainingRequests: 999, limitRequests: 1000, source: 'provider' });
    const gemini = s.providers.find((p) => p.provider === 'gemini')!;
    expect(gemini.models[0]).toMatchObject({ requests: 1, remainingRequests: null, source: 'unknown' });
    expect(s.knownRemainingRequests).toBe(999 + 0); // groq/llama-8b has no known limit either
  });

  it('estimates remaining from catalog limits when the provider sends nothing', async () => {
    await saveKey(db, userId, 'groq', 'gsk_mine', null, TEST_VAULT_KEY);
    const { models } = await import('@/db/schema');
    const { eq } = await import('drizzle-orm');
    await db.update(models).set({ rpd: 100 }).where(eq(models.modelId, 'llama-8b'));
    await recordUsage(db, { userId, source: 'api', provider: 'groq', modelId: 'llama-8b', promptTokens: 1, completionTokens: 1, latencyMs: 1, status: 'ok' });
    const s = await getUsageSummary(userId, deps());
    const fast = s.providers[0].models.find((m) => m.modelId === 'llama-8b')!;
    expect(fast).toMatchObject({ remainingRequests: 99, limitRequests: 100, source: 'estimate' });
  });

  it('shows cooldowns and OpenRouter free-request counts', async () => {
    await saveKey(db, userId, 'openrouter', 'sk-or-mine', null, TEST_VAULT_KEY);
    const kv = createMemoryKV();
    await kv.set(`cd:${userId}:openrouter`, String(Date.now() + 60_000), 60_000);
    const f = fakeFetch((url) =>
      url.endsWith('/api/v1/key')
        ? Response.json({ data: { free_model_daily_requests: { used: 12, limit: 50, remaining: 38 }, is_free_tier: true } })
        : new Response('{}', { status: 500 }));
    const s = await getUsageSummary(userId, { ...deps(f.fn), kv });
    const or = s.providers.find((p) => p.provider === 'openrouter')!;
    expect(or.coolingUntil).toBeInstanceOf(Date);
    expect(or.account).toMatchObject({ label: 'Free-model requests today', used: 12, limit: 50, remaining: 38, period: 'day', source: 'provider' });
    expect(s.knownRemainingRequests).toBe(38);
    expect(f.calls[0].auth).toBe('Bearer sk-or-mine');
  });

  it('counts a shared account pool once, not once per model', async () => {
    const { models, usageEvents } = await import('@/db/schema');
    await db.insert(models).values([
      { provider: 'openrouter', modelId: 'a:free', displayName: 'A', tier: 'smart', priority: 1, contextWindow: 1000, supportsTools: false, rpd: 50 },
      { provider: 'openrouter', modelId: 'b:free', displayName: 'B', tier: 'smart', priority: 2, contextWindow: 1000, supportsTools: false, rpd: 50 },
      { provider: 'openrouter', modelId: 'c:free', displayName: 'C', tier: 'fast', priority: 3, contextWindow: 1000, supportsTools: false, rpd: 50 },
      { provider: 'cohere', modelId: 'cmd-a', displayName: 'Command A', tier: 'smart', priority: 1, contextWindow: 1000, supportsTools: true, rpd: 1000 },
      { provider: 'cohere', modelId: 'cmd-r', displayName: 'Command R', tier: 'fast', priority: 2, contextWindow: 1000, supportsTools: true, rpd: 1000 },
    ]);
    await saveKey(db, userId, 'openrouter', 'sk-or-mine', null, TEST_VAULT_KEY);
    await saveKey(db, userId, 'cohere', 'co-mine', null, TEST_VAULT_KEY);
    const ev = { userId, source: 'api' as const, promptTokens: 1, completionTokens: 1, latencyMs: 1, status: 'ok' as const };
    await recordUsage(db, { ...ev, provider: 'openrouter', modelId: 'a:free' });
    await recordUsage(db, { ...ev, provider: 'openrouter', modelId: 'b:free' });
    await recordUsage(db, { ...ev, provider: 'cohere', modelId: 'cmd-a' });
    // cohere trial calls earlier this month still count against the monthly pool, but not "today"
    const now = new Date();
    const earlier = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 30));
    const thisMonthNotToday = earlier < new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await db.insert(usageEvents).values({ ...ev, provider: 'cohere', modelId: 'cmd-r', createdAt: earlier });

    const s = await getUsageSummary(userId, deps()); // OpenRouter's /key fails → estimate from the ledger
    const or = s.providers.find((p) => p.provider === 'openrouter')!;
    expect(or.account).toMatchObject({ used: 2, limit: 50, remaining: 48, period: 'day', source: 'estimate' });
    expect(or.models.every((m) => m.source === 'shared' && m.remainingRequests == null)).toBe(true);
    const co = s.providers.find((p) => p.provider === 'cohere')!;
    expect(co.account).toMatchObject({ used: 2, limit: 1000, remaining: 998, period: 'month' });
    expect(s.knownRemainingRequests).toBe(48 + 998); // not 3×50 + 2×1000
    expect(s.today.requests).toBe(thisMonthNotToday ? 3 : 4);
  });

  it('treats a live snapshot whose reset time has passed as refilled', async () => {
    await saveKey(db, userId, 'groq', 'gsk_mine', null, TEST_VAULT_KEY);
    const base = { limitTokens: null, remainingTokens: null, tokensResetAt: null };
    await saveLimits(db, userId, 'groq', 'llama-70b', { ...base, limitRequests: 1000, remainingRequests: 983, requestsResetAt: new Date(Date.now() - 60_000) });
    await saveLimits(db, userId, 'groq', 'llama-8b', { ...base, limitRequests: 1000, remainingRequests: 990, requestsResetAt: new Date(Date.now() + 60_000) });
    const s = await getUsageSummary(userId, deps());
    const groq = s.providers.find((p) => p.provider === 'groq')!;
    const stale = groq.models.find((m) => m.modelId === 'llama-70b')!;
    const fresh = groq.models.find((m) => m.modelId === 'llama-8b')!;
    expect(stale).toMatchObject({ remainingRequests: 1000, resetAt: null, source: 'provider' });
    expect(stale.asOf).not.toBeNull();
    expect(fresh.remainingRequests).toBe(990);
    expect(fresh.resetAt).not.toBeNull();
    expect(s.knownRemainingRequests).toBe(1990);
    const d = new Date(s.dayStartedAt);
    expect(d.getUTCHours() + d.getUTCMinutes() + d.getUTCSeconds()).toBe(0);
  });

  it('only reports the signed-in user', async () => {
    const other = (await createUser(db)).id;
    await saveKey(db, other, 'groq', 'gsk_other', null, TEST_VAULT_KEY);
    await recordUsage(db, { userId: other, source: 'api', provider: 'groq', modelId: 'llama-70b', promptTokens: 5, completionTokens: 5, latencyMs: 1, status: 'ok' });
    const s = await getUsageSummary(userId, deps());
    expect(s.providers).toEqual([]);
    expect(s.today).toEqual({ requests: 0, tokens: 0 });
  });
});
