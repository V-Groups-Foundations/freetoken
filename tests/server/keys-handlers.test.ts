import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import { fakeFetch, okJson } from '../helpers/fake-fetch';
import type { DB } from '@/db';
import { createMemoryKV } from '@/lib/kv';
import { listKeys } from '@/keys/service';
import { handleSaveKey } from '@/server/keys-handlers';

let db: DB;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  userId = (await createUser(db)).id;
});
const deps = (status = 200) => ({
  db, kv: createMemoryKV(), vaultKey: TEST_VAULT_KEY,
  fetchImpl: fakeFetch(() => (status === 200 ? okJson() : new Response('{}', { status }))).fn,
});

describe('handleSaveKey', () => {
  it('saves a key that passes the test call', async () => {
    const r = await handleSaveKey(userId, { provider: 'groq', key: 'gsk_12345678' }, deps());
    expect(r).toEqual({ status: 200, body: { ok: true, note: null } });
    expect(await listKeys(db, userId)).toHaveLength(1);
  });
  it('does not save a rejected key', async () => {
    const r = await handleSaveKey(userId, { provider: 'groq', key: 'gsk_12345678' }, deps(401));
    expect(r.status).toBe(400);
    expect(await listKeys(db, userId)).toHaveLength(0);
  });
  it('saves a rate-limited key with a note', async () => {
    const r = await handleSaveKey(userId, { provider: 'groq', key: 'gsk_12345678' }, deps(429));
    expect(r).toMatchObject({ status: 200, body: { ok: true, note: expect.any(String) } });
  });
  it('validates input', async () => {
    expect((await handleSaveKey(userId, { provider: 'nope', key: 'k'.repeat(10) }, deps())).status).toBe(400);
    expect((await handleSaveKey(userId, { provider: 'groq', key: 'short' }, deps())).status).toBe(400);
    expect((await handleSaveKey(userId, null, deps())).status).toBe(400);
  });
});
