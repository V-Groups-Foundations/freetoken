import { describe, it, expect } from 'vitest';
import { selectCandidates, parseModelRef, rankParts, speedBonus, type CatalogModel, type SelectInput } from '@/router/select';

const m = (provider: string, modelId: string, tier: string, priority: number, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  provider, modelId, displayName: modelId, tier, priority, contextWindow: 100_000,
  supportsTools: true, rpd: null, tpd: null, enabled: true, ...extra,
});

const catalog = [
  m('groq', 'llama-70b', 'smart', 1),
  m('gemini', 'flash', 'smart', 2),
  m('openrouter', 'meta-llama/llama-3.3-70b-instruct:free', 'smart', 3, { supportsTools: false }),
  m('groq', 'llama-8b', 'fast', 1),
];

const base = (o: Partial<SelectInput> = {}): SelectInput => ({
  requested: 'auto-smart',
  models: catalog,
  connected: [{ provider: 'groq', excludedFromAuto: false }, { provider: 'gemini', excludedFromAuto: false }, { provider: 'openrouter', excludedFromAuto: false }],
  cooling: new Set(),
  usageToday: new Map(),
  promptTokens: 10,
  needsTools: false,
  ...o,
});

const ids = (r: CatalogModel[]) => r.map((x) => `${x.provider}/${x.modelId}`);

describe('parseModelRef', () => {
  it('splits on the first slash only', () => {
    expect(parseModelRef('openrouter/meta-llama/llama-3.3-70b-instruct:free')).toEqual({
      provider: 'openrouter', modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    });
    expect(parseModelRef('noslash')).toBeNull();
    expect(parseModelRef('groq/')).toBeNull();
  });
});

describe('selectCandidates', () => {
  it('orders auto tier by priority', () => {
    expect(ids(selectCandidates(base()))).toEqual(['groq/llama-70b', 'gemini/flash', 'openrouter/meta-llama/llama-3.3-70b-instruct:free']);
  });
  it('only uses connected providers', () => {
    expect(ids(selectCandidates(base({ connected: [{ provider: 'gemini', excludedFromAuto: false }] })))).toEqual(['gemini/flash']);
  });
  it('skips cooling providers and over-limit models', () => {
    const r = selectCandidates(base({
      cooling: new Set(['groq']),
      models: catalog.map((x) => (x.provider === 'gemini' ? { ...x, rpd: 10 } : x)),
      usageToday: new Map([['gemini/flash', { requests: 10, tokens: 0 }]]),
    }));
    expect(ids(r)).toEqual(['openrouter/meta-llama/llama-3.3-70b-instruct:free']);
  });
  it('counts failed calls toward a daily limit: 7 successes and 3 errors spend a 10-a-day allowance', () => {
    const r = selectCandidates(base({
      models: catalog.map((x) => (x.provider === 'gemini' ? { ...x, rpd: 10 } : x)),
      usageToday: new Map([['gemini/flash', { requests: 7, attempts: 10, tokens: 0 }]]),
    }));
    expect(ids(r)).not.toContain('gemini/flash');
  });
  it('filters by context window and tool support (Gemini included: its thought signatures are restored)', () => {
    expect(ids(selectCandidates(base({ needsTools: true })))).toEqual(['groq/llama-70b', 'gemini/flash']);
    expect(selectCandidates(base({ promptTokens: 200_000 }))).toEqual([]);
  });
  it("skips a model whose provider caps a request below this prompt's size (Groq refuses with 413)", () => {
    const caps = new Map([['groq/llama-70b', 8000]]);
    expect(ids(selectCandidates(base({ promptTokens: 20_000, tokenCaps: caps })))).not.toContain('groq/llama-70b');
    expect(ids(selectCandidates(base({ promptTokens: 5_000, tokenCaps: caps })))[0]).toBe('groq/llama-70b');
  });
  it('a conversation stays on its model unless another is clearly better or it keeps failing', () => {
    const agent = (o: Partial<SelectInput>) => ids(selectCandidates(base({ task: 'agent', needsTools: true, ...o })))[0];
    expect(agent({})).toBe('groq/llama-70b');
    expect(agent({ pinned: 'gemini/flash' })).toBe('gemini/flash');
    expect(agent({ pinned: 'gemini/flash', learned: new Map([['groq/llama-70b', 10]]) })).toBe('groq/llama-70b'); // clearly better
    expect(agent({ pinned: 'gemini/flash', recentFailures: new Map([['gemini/flash', 2]]) })).toBe('groq/llama-70b');
    expect(agent({ pinned: 'nope/gone' })).toBe('groq/llama-70b');
    // a model that only stood in while the best one was busy hands back as soon as it's free…
    expect(agent({ pinned: 'gemini/flash', pinnedFallback: true })).toBe('groq/llama-70b');
    // …and keeps the conversation while the best one is still busy
    expect(agent({ pinned: 'gemini/flash', pinnedFallback: true, cooling: new Set(['groq']) })).toBe('gemini/flash');
  });
  it('between models of about the same quality, the faster writer goes first (a little, never more than 3 points)', () => {
    expect(speedBonus(34)).toBe(-2);
    expect(speedBonus(62)).toBe(1.5);
    expect(speedBonus(400)).toBe(3);
    expect(speedBonus(undefined)).toBe(0);
    const agent = (o: Partial<SelectInput>) => ids(selectCandidates(base({ task: 'agent', needsTools: true, ...o })))[0];
    // two models a point apart: the slow one at the top gives way to the faster one
    const close = new Map([['groq/llama-70b', -(rankParts({ provider: 'groq', modelId: 'llama-70b' }, 'agent', {}).score - rankParts({ provider: 'gemini', modelId: 'flash' }, 'agent', {}).score) + 1]]);
    expect(agent({ learned: close })).toBe('groq/llama-70b');
    expect(agent({ learned: close, speed: new Map([['groq/llama-70b', 30], ['gemini/flash', 90]]) })).toBe('gemini/flash');
  });
  it('puts an explicit model first, then same-tier fallbacks', () => {
    expect(ids(selectCandidates(base({ requested: 'gemini/flash' })))).toEqual(['gemini/flash', 'groq/llama-70b', 'openrouter/meta-llama/llama-3.3-70b-instruct:free']);
  });
  it('excludes excluded providers from auto and fallback but allows them explicitly', () => {
    const connected = [{ provider: 'groq', excludedFromAuto: false }, { provider: 'gemini', excludedFromAuto: true }];
    expect(ids(selectCandidates(base({ connected })))).toEqual(['groq/llama-70b']);
    expect(ids(selectCandidates(base({ connected, requested: 'gemini/flash' })))).toEqual(['gemini/flash', 'groq/llama-70b']);
  });
  it('returns nothing for unknown explicit models', () => {
    expect(selectCandidates(base({ requested: 'groq/unknown' }))).toEqual([]);
  });
});
