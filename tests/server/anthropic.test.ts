import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY, seedTestModels } from '../helpers/fixtures';
import { fakeFetch, okJson, sse, type Handler } from '../helpers/fake-fetch';
import type { DB } from '@/db';
import { createMemoryKV } from '@/lib/kv';
import { saveKey } from '@/keys/service';
import { createToken } from '@/server/tokens';
import { handleCountTokens, handleMessages } from '@/server/anthropic';

let db: DB;
let token: string;
beforeEach(async () => {
  db = await createTestDb();
  await seedTestModels(db);
  const userId = (await createUser(db)).id;
  await saveKey(db, userId, 'groq', 'gsk_mine', null, TEST_VAULT_KEY);
  token = await createToken(db, userId, 'claude-code');
});
const pong: Handler = () => okJson('pong');
const deps = (handler: Handler = pong) => ({ db, kv: createMemoryKV(), vaultKey: TEST_VAULT_KEY, fetchImpl: fakeFetch(handler).fn });
const post = (path: string, headers: Record<string, string>, body: unknown) =>
  new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const msg = { model: 'claude-sonnet-4-5', max_tokens: 1024, messages: [{ role: 'user', content: 'ping' }] };

describe('/v1/messages (Anthropic-compatible)', () => {
  it('accepts the ft_ token as x-api-key or bearer, rejects anything else', async () => {
    expect((await handleMessages(post('/api/v1/messages', {}, msg), deps())).status).toBe(401);
    const bad = await handleMessages(post('/api/v1/messages', { 'x-api-key': 'sk-ant-real-key' }, msg), deps());
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.type).toBe('authentication_error');
    expect((await handleMessages(post('/api/v1/messages', { 'x-api-key': token }, msg), deps())).status).toBe(200);
    expect((await handleMessages(post('/api/v1/messages', { authorization: `Bearer ${token}` }, msg), deps())).status).toBe(200);
  });

  it('a malformed message is a 400 in Anthropic format, not a server error', async () => {
    const res = await handleMessages(post('/api/v1/messages', { 'x-api-key': token }, { ...msg, messages: [null] }), deps());
    expect(res.status).toBe(400);
    expect((await res.json()).error.type).toBe('invalid_request_error');
  });

  it("answers in Anthropic format, routed through the user's providers", async () => {
    const res = await handleMessages(post('/api/v1/messages', { 'x-api-key': token }, msg), deps());
    const body = await res.json();
    expect(res.headers.get('x-freetoken-provider')).toBeTruthy();
    expect(body).toMatchObject({ type: 'message', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'pong' }], stop_reason: 'end_turn' });
  });

  it('streams Anthropic server-sent events', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"po"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"ng"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const res = await handleMessages(post('/api/v1/messages', { 'x-api-key': token }, { ...msg, stream: true }), deps(() => sse(chunks)));
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text.startsWith('event: message_start')).toBe(true);
    expect(text).toContain('"text":"po"');
    expect(text.trim().endsWith('data: {"type":"message_stop"}')).toBe(true);
  });

  it('count_tokens returns an estimate', async () => {
    const res = await handleCountTokens(post('/api/v1/messages/count_tokens', { 'x-api-key': token }, msg), deps());
    expect((await res.json()).input_tokens).toBeGreaterThan(0);
  });
});
