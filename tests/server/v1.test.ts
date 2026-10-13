import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY, seedTestModels } from '../helpers/fixtures';
import { fakeFetch, okJson } from '../helpers/fake-fetch';
import type { DB } from '@/db';
import { createMemoryKV } from '@/lib/kv';
import { saveKey } from '@/keys/service';
import { createToken, listTokens, revokeToken } from '@/server/tokens';
import { handleCompletions, handleModels } from '@/server/v1';

let db: DB;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  await seedTestModels(db);
  userId = (await createUser(db)).id;
  await saveKey(db, userId, 'groq', 'gsk_mine', null, TEST_VAULT_KEY);
});
const deps = () => ({ db, kv: createMemoryKV(), vaultKey: TEST_VAULT_KEY, fetchImpl: fakeFetch(() => okJson('pong')).fn });
const req = (path: string, token: string | null, body?: unknown) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
const chat = { model: 'auto-smart', messages: [{ role: 'user', content: 'ping' }] };

describe('/v1/chat/completions', () => {
  it('rejects missing, unknown and revoked tokens with OpenAI-style errors', async () => {
    const none = await handleCompletions(req('/api/v1/chat/completions', null, chat), deps());
    expect(none.status).toBe(401);
    expect((await none.json()).error.code).toBe('invalid_api_key');
    expect((await handleCompletions(req('/api/v1/chat/completions', 'ft_fake', chat), deps())).status).toBe(401);
    const raw = await createToken(db, userId, 'cli');
    const [t] = await listTokens(db, userId);
    await revokeToken(db, userId, t.id);
    expect((await handleCompletions(req('/api/v1/chat/completions', raw, chat), deps())).status).toBe(401);
  });

  it('routes an authenticated request and labels the provider', async () => {
    const raw = await createToken(db, userId, 'cli');
    const res = await handleCompletions(req('/api/v1/chat/completions', raw, chat), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-freetoken-provider')).toBe('groq/llama-70b');
    expect((await res.json()).choices[0].message.content).toBe('pong');
  });

  it('returns 400 for invalid JSON and empty messages', async () => {
    const raw = await createToken(db, userId, 'cli');
    expect((await handleCompletions(req('/api/v1/chat/completions', raw, '{oops'), deps())).status).toBe(400);
    expect((await handleCompletions(req('/api/v1/chat/completions', raw, { messages: [] }), deps())).status).toBe(400);
  });

  it('cannot revoke another user’s token', async () => {
    const other = (await createUser(db)).id;
    const raw = await createToken(db, userId, 'cli');
    const [t] = await listTokens(db, userId);
    await revokeToken(db, other, t.id);
    expect((await handleCompletions(req('/api/v1/chat/completions', raw, chat), deps())).status).toBe(200);
  });
});

describe('/v1/models', () => {
  it('lists auto models plus connected provider models', async () => {
    const raw = await createToken(db, userId, 'cli');
    const body = await (await handleModels(req('/api/v1/models', raw), deps())).json();
    expect(body.data.map((m: { id: string }) => m.id)).toEqual(['auto-smart', 'auto-fast', 'groq/llama-70b', 'groq/llama-8b']);
  });
});
