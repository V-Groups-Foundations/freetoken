import { describe, it, expect } from 'vitest';
import { selectCandidates, parseModelRef, type CatalogModel, type SelectInput } from '@/router/select';

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
  it('filters by context window and tool support, and excludes tool-incompatible providers (Gemini)', () => {
    // Gemini supports tools but can't round-trip them across turns, so it's dropped when tools are needed.
    expect(ids(selectCandidates(base({ needsTools: true })))).toEqual(['groq/llama-70b']);
    expect(selectCandidates(base({ promptTokens: 200_000 }))).toEqual([]);
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
