import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, createUser } from '../helpers/db';
import { fakeFetch, okJson, sse, type Handler } from '../helpers/fake-fetch';
import { TEST_VAULT_KEY, seedTestModels } from '../helpers/fixtures';
import type { DB } from '@/db';
import { providerKeys, usageEvents } from '@/db/schema';
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
    expect(ev).toMatchObject({ status: 'ok', completionTokens: 2 });
  });

  it('lists models for connected providers only', async () => {
    await connect('gemini', 'AIza_mine');
    expect((await listUserModels(db, userId)).map((m) => m.id)).toEqual(['gemini/flash']);
  });
});
