import { learnedAdjustment } from '@/router/quality';
import { createTestDb, createUser } from '../helpers/db';
import { learnedScores, recordFeedback, recordUsage } from '@/usage/ledger';
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
  it("a coding agent's three roles go to the models that did best at each in sandbox tests", () => {
    const best = (task: 'agent' | 'reasoning' | 'review') => ['groq/openai/gpt-oss-120b', 'nvidia/nvidia/nemotron-3-ultra-550b-a55b', 'nvidia/deepseek-ai/deepseek-v4.1-flash',
      'cohere/command-a-reasoning-08-2025', 'groq/qwen/qwen3.8-27b', 'nvidia/z-ai/glm-5.3-flash']
      .map((k) => [k, quality(k.split('/')[0], k.split('/').slice(1).join('/'), task)] as const).sort((a, b) => b[1] - a[1])[0][0];
    expect(best('reasoning')).toBe('groq/openai/gpt-oss-120b'); // planner
    expect(best('agent')).toBe('nvidia/nvidia/nemotron-3-ultra-550b-a55b'); // worker
    expect(best('review')).toBe('groq/openai/gpt-oss-120b'); // reviewer
    // Cloudflare's gpt-oss-120b plans well but broke down as an agent ("!!!!…")
    expect(quality('cloudflare', '@cf/openai/gpt-oss-120b', 'agent')).toBeLessThan(quality('cohere', 'command-a-plus-05-2026', 'agent'));
    // a model never measured as a reviewer goes by its reasoning score
    expect(quality('gemini', 'gemini-3.8-flash', 'review')).toBe(quality('gemini', 'gemini-3.8-flash', 'reasoning'));
  });
});

describe('auto routing: best model for the task first, weaker ones once those are spent', () => {
  it('coding agents get the best coding agent model; reasoning gets the best reasoner', () => {
    // the worker: Nemotron Ultra fixed every planted bug in the sandbox test, even keyless (shared) it leads
    expect(order({ task: 'agent' })[0]).toBe('kilo/nvidia/nemotron-3-ultra-550b-a55b:free');
    // the planner: GPT-OSS 120B found every bug in each round
    expect(order({ task: 'reasoning' })[0]).toBe('groq/openai/gpt-oss-120b');
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

describe('auto routing learns from real results', () => {
  it('scores: little history changes little; unreliable or badly-reviewed models drop, good ones rise a bit', () => {
    expect(learnedAdjustment({ ok: 2, errors: 2, good: 0, bad: 0 })).toBe(0); // too few runs to judge
    expect(learnedAdjustment({ ok: 15, errors: 15, good: 0, bad: 0 })).toBe(-16);
    expect(learnedAdjustment({ ok: 30, errors: 0, good: 6, bad: 0 })).toBe(10);
    expect(learnedAdjustment({ ok: 30, errors: 0, good: 0, bad: 6 })).toBeLessThan(-5);
    expect(learnedAdjustment({ ok: 0, errors: 100, good: 0, bad: 100 })).toBe(-20); // capped
  });
  it('benchmark runs (real tasks, graded by running them) weigh more than everyday votes', () => {
    const quiet = { ok: 0, errors: 0, good: 0, bad: 0 };
    expect(learnedAdjustment({ ...quiet, benchPassed: 2, benchTotal: 2 })).toBe(0); // too few to judge
    expect(learnedAdjustment({ ...quiet, benchPassed: 8, benchTotal: 8 })).toBe(12);
    expect(learnedAdjustment({ ...quiet, benchPassed: 6, benchTotal: 8 })).toBe(0);
    expect(learnedAdjustment({ ...quiet, benchPassed: 4, benchTotal: 8 })).toBe(-12);
    // a model that does well day to day but fails the benchmark ends up below one that passes it
    expect(learnedAdjustment({ ok: 30, errors: 0, good: 6, bad: 0, benchPassed: 2, benchTotal: 8 }))
      .toBeLessThan(learnedAdjustment({ ok: 30, errors: 0, good: 0, bad: 0, benchPassed: 8, benchTotal: 8 }));
    expect(learnedAdjustment({ ok: 30, errors: 0, good: 6, bad: 0, benchPassed: 8, benchTotal: 8 })).toBe(16); // capped
  });
  it('a model clients keep reporting as bad loses its first place for that task only', () => {
    const top = 'kilo/nvidia/nemotron-3-ultra-550b-a55b:free';
    const learned = new Map([[top, -12]]);
    expect(order({ task: 'agent', learned })[0]).not.toBe(top);
    expect(order({ task: 'agent' })[0]).toBe(top);
    expect(order({ task: 'reasoning', learned })[0]).toBe('groq/openai/gpt-oss-120b');
  });
  it('reads per-task history and feedback from the database', async () => {
    const db = await createTestDb();
    const { id } = await createUser(db);
    const ev = { userId: id, provider: 'groq', modelId: 'q', source: 'api' as const, promptTokens: 1, completionTokens: 1, latencyMs: 1 };
    for (let i = 0; i < 10; i++) await recordUsage(db, { ...ev, task: 'agent', status: i < 5 ? 'ok' : 'error' });
    for (let i = 0; i < 10; i++) await recordUsage(db, { ...ev, task: 'chat', status: 'ok' });
    for (let i = 0; i < 4; i++) await recordUsage(db, { ...ev, task: 'agent', status: 'rate_limited' }); // quota, not quality
    await recordFeedback(db, { userId: id, provider: 'groq', modelId: 'q', task: 'agent', good: false, reason: 'invalid tool call' });
    const since = new Date(Date.now() - 86_400_000);
    const agent = (await learnedScores(db, id, 'agent', since)).get('groq/q')!;
    expect(agent).toBeLessThan(-5);
    expect((await learnedScores(db, id, 'chat', since)).get('groq/q')).toBeGreaterThan(0);
  });
});
