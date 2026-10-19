import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, createUser } from '../helpers/db';
import { fakeFetch, okJson, sse, type Handler } from '../helpers/fake-fetch';
import { TEST_VAULT_KEY, seedTestModels } from '../helpers/fixtures';
import type { DB } from '@/db';
import { models, providerKeys, usageEvents } from '@/db/schema';
import { createMemoryKV, type KV } from '@/lib/kv';
import { saveKey } from '@/keys/service';
import { routeChat } from '@/router/execute';
import { listUserModels } from '@/router/models';

const GROQ = 'api.groq.com';

let db: DB;
let userId: string;
let kv: KV;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestModels(db);
  userId = (await createUser(db)).id;
  kv = createMemoryKV();
});

const connect = async (provider: string, key: string, uid = userId) => saveKey(db, uid, provider, key, null, TEST_VAULT_KEY);
const run = (handler: Handler, body: Record<string, unknown> = {}, uid = userId) => {
  const f = fakeFetch(handler);
  const p = routeChat(
    { userId: uid, source: 'api', body: { model: 'auto-smart', messages: [{ role: 'user', content: 'hi' }], ...body } },
    { db, kv, fetchImpl: f.fn, vaultKey: TEST_VAULT_KEY },
  );
  return { f, p };
};

describe('routeChat', () => {
  it('uses the top-priority provider, labels the response, records usage', async () => {
    await connect('groq', 'gsk_mine');
    const { f, p } = run(() => okJson('hi there'));
    const out = await p;
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.response.headers.get('x-freetoken-provider')).toBe('groq/llama-70b');
    expect((await out.response.json()).choices[0].message.content).toBe('hi there');
    expect(f.calls[0].body).toMatchObject({ model: 'llama-70b' });
    const [ev] = await db.select().from(usageEvents);
    expect(ev).toMatchObject({ provider: 'groq', status: 'ok', promptTokens: 5, completionTokens: 2 });
  });

  it('falls back on 429, then skips the cooling provider on the next call', async () => {
    await connect('groq', 'gsk_mine');
    await connect('gemini', 'AIza_mine');
    const handler: Handler = (url) =>
      url.includes(GROQ) ? new Response('{"error":{"message":"limit"}}', { status: 429, headers: { 'retry-after': '120' } }) : okJson();
    const first = run(handler);
    const out = await first.p;
    expect(out.ok && out.response.headers.get('x-freetoken-provider')).toBe('gemini/flash');
    const second = run(handler);
    await second.p;
    expect(second.f.calls.map((c) => c.url).some((u) => u.includes(GROQ))).toBe(false);
  });

  it('does not cool a provider when a model is 404 (retired), so its other models still get tried', async () => {
    await connect('groq', 'gsk_mine');
    await connect('gemini', 'AIza_mine');
    // groq's smart model is retired (404); gemini answers this call.
    const handler: Handler = (url) =>
      url.includes(GROQ) ? new Response('{"error":{"message":"model_not_found"}}', { status: 404 }) : okJson();
    await run(handler).p;
    // Next call must still try groq (not cooled) — contrast with the 429 case which skips it.
    const second = run(handler);
    await second.p;
    expect(second.f.calls.some((c) => c.url.includes(GROQ))).toBe(true);
  });

  it('falls back past an HTML 502 without crashing', async () => {
    await connect('groq', 'gsk_mine');
    await connect('gemini', 'AIza_mine');
    const { p } = run((url) => (url.includes(GROQ) ? new Response('<html>502</html>', { status: 502 }) : okJson()));
    const out = await p;
    expect(out.ok && out.response.headers.get('x-freetoken-provider')).toBe('gemini/flash');
  });

  it('marks a rejected key invalid and falls back', async () => {
    await connect('groq', 'gsk_revoked');
    await connect('gemini', 'AIza_mine');
    await run((url) => (url.includes(GROQ) ? new Response('{}', { status: 401 }) : okJson())).p;
    const [row] = await db.select().from(providerKeys).where(eq(providerKeys.provider, 'groq'));
    expect(row.status).toBe('invalid');
  });

  it('returns all_providers_exhausted when everything fails', async () => {
    await connect('groq', 'gsk_mine');
    const out = await run(() => new Response('{}', { status: 429 })).p;
    expect(out).toMatchObject({ ok: false, status: 429, code: 'all_providers_exhausted' });
    expect(!out.ok && out.message).toContain('/connect');
  });

  it('does not fall back on a bad request', async () => {
    await connect('groq', 'gsk_mine');
    await connect('gemini', 'AIza_mine');
    const { f, p } = run(() => new Response('{"error":{"message":"bad param"}}', { status: 400 }));
    expect(await p).toMatchObject({ ok: false, status: 400, message: 'bad param' });
    expect(f.calls).toHaveLength(1);
  });

  describe('built-in keyless starter', () => {
    const POLL = 'text.pollinations.ai';
    const addStarter = () => db.insert(models).values([
      { provider: 'starter', modelId: 'openai', displayName: 'Starter', tier: 'smart', priority: 90, contextWindow: 131072, supportsTools: true },
      { provider: 'starter', modelId: 'openai-fast', displayName: 'Starter fast', tier: 'fast', priority: 90, contextWindow: 131072, supportsTools: true },
    ]);

    it('answers with no keys at all, without sending a key', async () => {
      await addStarter();
      const { f, p } = run(() => okJson('hi from starter'));
      expect((await p).ok).toBe(true);
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0].url).toContain(POLL);
      expect(f.calls[0].auth).toBeNull();
    });

    it("is only a fallback: the user's own provider goes first", async () => {
      await addStarter();
      await connect('groq', 'gsk_mine');
      const { f, p } = run((url) => (url.includes(GROQ) ? new Response('{}', { status: 429 }) : okJson('saved by starter')));
      expect((await p).ok).toBe(true);
      expect(f.calls[0].url).toContain(GROQ);
      expect(f.calls.at(-1)!.url).toContain(POLL);
    });

    it('keyless gateways (Kilo, LLM7) come before the starter, keyless; a saved key is sent instead', async () => {
      await addStarter();
      await db.insert(models).values([
        { provider: 'kilo', modelId: 'k:free', displayName: 'Kilo', tier: 'smart', priority: 78, contextWindow: 131072, supportsTools: true },
        { provider: 'llm7', modelId: 'l', displayName: 'LLM7', tier: 'smart', priority: 84, contextWindow: 131072, supportsTools: true },
      ]);
      const first = run((url) => (url.includes('kilo.ai') ? new Response('{}', { status: 429 }) : okJson('from llm7')));
      expect((await first.p).ok).toBe(true);
      expect(first.f.calls.map((c) => new URL(c.url).host)).toEqual(['ai-gateway.kilo.ai', 'api.llm7.io']);
      expect(first.f.calls.every((c) => c.auth === null)).toBe(true);

      await connect('llm7', 'llm7_token_mine');
      const keyed = run(() => okJson('ok'), { model: 'llm7/l' });
      expect((await keyed.p).ok).toBe(true);
      expect(keyed.f.calls[0].auth).toBe('Bearer llm7_token_mine');
    });

    it('can be turned off with FREETOKEN_STARTER=off', async () => {
      await addStarter();
      process.env.FREETOKEN_STARTER = 'off';
      try { expect(await run(() => okJson()).p).toMatchObject({ ok: false, status: 400, code: 'no_providers' }); }
      finally { delete process.env.FREETOKEN_STARTER; }
    });
  });

  it('explains when no providers are connected', async () => {
    expect(await run(() => okJson()).p).toMatchObject({ ok: false, status: 400, code: 'no_providers' });
  });

  it('rejects unknown models', async () => {
    await connect('groq', 'gsk_mine');
    expect(await run(() => okJson(), { model: 'groq/nope' }).p).toMatchObject({ ok: false, status: 404, code: 'model_not_found' });
  });

  it('never uses another user’s keys', async () => {
    const other = (await createUser(db)).id;
    await connect('gemini', 'AIza_OTHER_USER', other);
    await connect('groq', 'gsk_mine');
    const { f, p } = run(() => new Response('{}', { status: 429 }));
    await p;
    expect(f.calls.length).toBeGreaterThan(0);
    for (const c of f.calls) expect(c.auth).toBe('Bearer gsk_mine');
  });

  it('streams through and records estimated usage when no usage chunk is sent', async () => {
    await connect('groq', 'gsk_mine');
    const chunks = ['data: {"choices":[{"delta":{"content":"abcdefgh"}}]}\n\n', 'data: [DONE]\n\n'];
    const out = await run(() => sse(chunks), { stream: true }).p;
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(await out.response.text()).toBe(chunks.join(''));
    await new Promise((r) => setTimeout(r, 50)); // usage is recorded after the stream ends
    const [ev] = await db.select().from(usageEvents);
    expect(ev).toMatchObject({ status: 'ok', completionTokens: 2, estimated: true });
  });

  it('asks for usage on streams, records real counts and hides the extra chunk from the client', async () => {
    await connect('groq', 'gsk_mine');
    const content = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n';
    const usage = 'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":3}}\n\n';
    let sent: Record<string, unknown> = {};
    const { p } = run((_url, init) => { sent = JSON.parse(String(init?.body)); return sse([content, usage, 'data: [DONE]\n\n']); }, { stream: true });
    const out = await p;
    if (!out.ok) throw new Error('expected ok');
    expect(await out.response.text()).toBe(`${content}data: [DONE]\n\n`);
    expect(sent.stream_options).toEqual({ include_usage: true });
    await new Promise((r) => setTimeout(r, 50));
    const [ev] = await db.select().from(usageEvents);
    expect(ev).toMatchObject({ promptTokens: 11, completionTokens: 3, estimated: false });
  });

  it('passes the usage chunk through when the client asked for it', async () => {
    await connect('groq', 'gsk_mine');
    const chunks = ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n', 'data: [DONE]\n\n'];
    const out = await run(() => sse(chunks), { stream: true, stream_options: { include_usage: true } }).p;
    if (!out.ok) throw new Error('expected ok');
    expect(await out.response.text()).toBe(chunks.join(''));
  });

  it('retries without stream_options when a provider rejects it', async () => {
    await connect('groq', 'gsk_mine');
    const bodies: Record<string, unknown>[] = [];
    const out = await run((_url, init) => {
      const b = JSON.parse(String(init?.body));
      bodies.push(b);
      return b.stream_options ? new Response('{"error":{"message":"unknown field stream_options"}}', { status: 400 }) : sse(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']);
    }, { stream: true }).p;
    expect(out.ok).toBe(true);
    expect(bodies.map((b) => 'stream_options' in b)).toEqual([true, false]);
  });

  it('lists models for connected providers only', async () => {
    await connect('gemini', 'AIza_mine');
    expect((await listUserModels(db, userId)).map((m) => m.id)).toEqual(['gemini/flash']);
  });

  it('falls back when an upstream 200 body is not valid JSON', async () => {
    await connect('groq', 'gsk_mine');
    await connect('gemini', 'AIza_mine');
    const { p } = run((url) => (url.includes(GROQ) ? new Response('<html>captive portal</html>', { status: 200, headers: { 'content-type': 'text/html' } }) : okJson()));
    const out = await p;
    expect(out.ok && out.response.headers.get('x-freetoken-provider')).toBe('gemini/flash');
  });

  it('says no model can handle the request instead of blaming quota', async () => {
    await connect('groq', 'gsk_mine');
    const huge = [{ role: 'user', content: 'x'.repeat(500_000) }];
    const { f, p } = run(() => okJson(), { messages: huge });
    expect(await p).toMatchObject({ ok: false, status: 400, code: 'no_capable_model' });
    expect(f.calls).toHaveLength(0);
  });
});
