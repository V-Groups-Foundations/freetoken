import { describe, it, expect } from 'vitest';
import { detectTask, quality } from '@/router/quality';
import { selectCandidates, type CatalogModel } from '@/router/select';

const m = (provider: string, modelId: string, tier: 'smart' | 'fast', priority = 10, extra: Partial<CatalogModel> = {}): CatalogModel =>
  ({ provider, modelId, displayName: modelId, tier, priority, contextWindow: 131072, supportsTools: true, rpd: null, tpd: null, enabled: true, ...extra });

const models = [
  m('groq', 'openai/gpt-oss-120b', 'smart', 10),
  m('groq', 'qwen/qwen3.8-27b', 'smart', 15),
  m('cohere', 'command-a-03-2025', 'smart', 42),
  m('kilo', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'smart', 78),
  m('starter', 'openai', 'smart', 90),
  m('groq', 'openai/gpt-oss-20b', 'fast', 10),
];
const base = (extra: object = {}) => ({
  requested: 'auto-smart', models, cooling: new Set<string>(), usageToday: new Map(), promptTokens: 1000, needsTools: false,
  connected: ['groq', 'cohere', 'kilo', 'starter'].map((provider) => ({ provider, excludedFromAuto: false })), keyless: new Set(['kilo', 'starter']), ...extra,
});
const order = (extra: object) => selectCandidates(base(extra)).map((x) => `${x.provider}/${x.modelId}`);

describe('task detection', () => {
  it('reads the kind of request from the tools and the latest message', () => {
    expect(detectTask({ messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'write_file' } }] })).toBe('agent');
    expect(detectTask({ messages: [{ role: 'user', content: 'Fix this TypeError in my React component' }] })).toBe('code');
    expect(detectTask({ messages: [{ role: 'user', content: 'Solve this logic puzzle step by step' }] })).toBe('reasoning');
    expect(detectTask({ messages: [{ role: 'user', content: 'Write a short poem about rain' }] })).toBe('creative');
    expect(detectTask({ messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:x' } }] }] })).toBe('vision');
    expect(detectTask({ messages: [{ role: 'user', content: 'Good morning!' }] })).toBe('chat');
  });
  it('scores models per task (unknown models get a middling score)', () => {
    expect(quality('groq', 'qwen/qwen3.8-27b', 'code')).toBeGreaterThan(quality('groq', 'openai/gpt-oss-120b', 'code'));
    expect(quality('groq', 'openai/gpt-oss-120b', 'reasoning')).toBeGreaterThan(quality('groq', 'qwen/qwen3.8-27b', 'reasoning'));
    expect(quality('x', 'mystery-model', 'chat')).toBe(60);
  });
});

describe('auto routing: best model for the task first, weaker ones once those are spent', () => {
  it('coding agents get the best coding agent model; reasoning gets the best reasoner', () => {
    expect(order({ task: 'agent' })[0]).toBe('groq/qwen/qwen3.8-27b');
    // reasoning: GPT-OSS 120B on the user's own key narrowly beats the keyless Nemotron Ultra (shared, so it gives way in a close call)
    expect(order({ task: 'reasoning' }).slice(0, 2)).toEqual(['groq/openai/gpt-oss-120b', 'kilo/nvidia/nemotron-3-ultra-550b-a55b:free']);
  });
  it('skips a model with no quota left, demotes one that keeps failing', () => {
    expect(order({ task: 'agent', exhausted: new Set(['groq/qwen/qwen3.8-27b']) })).not.toContain('groq/qwen/qwen3.8-27b');
    expect(order({ task: 'agent', recentFailures: new Map([['groq/qwen/qwen3.8-27b', 3]]) })[0]).not.toBe('groq/qwen/qwen3.8-27b');
    const usedUp = new Map([['groq/qwen/qwen3.8-27b', { requests: 1000, tokens: 0 }]]);
    const withLimit = models.map((x) => (x.modelId === 'qwen/qwen3.8-27b' ? { ...x, rpd: 1000 } : x));
    expect(selectCandidates({ ...base({ task: 'agent', usageToday: usedUp }), models: withLimit }).map((x) => x.modelId)).not.toContain('qwen/qwen3.8-27b');
  });
  it('the shared starter stays last; the fast tier answers when every strong model is gone', () => {
    const o = order({ task: 'chat' });
    expect(o.indexOf('starter/openai')).toBe(o.length - 2); // last of the smart models, before the fast fallback
    expect(o.at(-1)).toBe('groq/openai/gpt-oss-20b');
    const allSpent = new Set(models.filter((x) => x.tier === 'smart').map((x) => `${x.provider}/${x.modelId}`));
    expect(order({ task: 'chat', exhausted: allSpent })).toEqual(['groq/openai/gpt-oss-20b']);
  });
  it('an explicitly chosen model keeps its place', () => {
    expect(selectCandidates({ ...base({ task: 'agent' }), requested: 'cohere/command-a-03-2025' })[0].modelId).toBe('command-a-03-2025');
  });
});
