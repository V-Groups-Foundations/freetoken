import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import { fakeFetch, okJson } from '../helpers/fake-fetch';
import { providerKeys } from '@/db/schema';
import type { DB } from '@/db';
import { getProvider } from '@/providers/registry';
import { saveKey, listKeys, loadCredentials, markInvalid, removeKey, setExcluded, validateKey } from '@/keys/service';

let db: DB;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  userId = (await createUser(db)).id;
});

describe('key storage', () => {
  it('encrypts at rest and exposes only last4', async () => {
    await saveKey(db, userId, 'groq', 'gsk_abcdefgh1234', null, TEST_VAULT_KEY);
    const [row] = await db.select().from(providerKeys);
    expect(row.encryptedKey).not.toContain('gsk_');
    const list = await listKeys(db, userId);
    expect(list).toEqual([{ provider: 'groq', last4: '1234', status: 'valid', excludedFromAuto: false }]);
    expect(JSON.stringify(list)).not.toContain('gsk_abcdefgh');
  });

  it('upserts, decrypts, and skips invalid keys', async () => {
    await saveKey(db, userId, 'cloudflare', 'old-token-0000', 'acc1', TEST_VAULT_KEY);
    await saveKey(db, userId, 'cloudflare', 'new-token-9999', 'acc2', TEST_VAULT_KEY);
    await saveKey(db, userId, 'groq', 'gsk_zzzzzzzz', null, TEST_VAULT_KEY);
    await markInvalid(db, userId, 'groq');
    const creds = await loadCredentials(db, userId, TEST_VAULT_KEY);
    expect([...creds.keys()]).toEqual(['cloudflare']);
    expect(creds.get('cloudflare')!.creds).toEqual({ key: 'new-token-9999', extra: 'acc2' });
  });

  it('isolates users and supports exclude/remove', async () => {
    const other = (await createUser(db)).id;
    await saveKey(db, other, 'gemini', 'AIza-other-user', null, TEST_VAULT_KEY);
    await saveKey(db, userId, 'gemini', 'AIza-mine-12345', null, TEST_VAULT_KEY);
    await setExcluded(db, userId, 'gemini', true);
    const mine = await loadCredentials(db, userId, TEST_VAULT_KEY);
    expect(mine.get('gemini')).toEqual({ creds: { key: 'AIza-mine-12345', extra: null }, excludedFromAuto: true });
    await removeKey(db, userId, 'gemini');
    expect(await listKeys(db, userId)).toEqual([]);
    expect(await listKeys(db, other)).toHaveLength(1);
  });
});

describe('validateKey', () => {
  const groq = getProvider('groq')!;
  const creds = { key: 'gsk_x', extra: null };
  it('accepts a working key with a 1-token call', async () => {
    const f = fakeFetch(() => okJson());
    expect(await validateKey(groq, creds, f.fn)).toEqual({ ok: true });
    expect(f.calls[0].body).toMatchObject({ model: groq.validateModel, max_tokens: 1 });
  });
  it('accepts a rate-limited key with a note', async () => {
    const r = await validateKey(groq, creds, fakeFetch(() => new Response('{}', { status: 429 })).fn);
    expect(r).toMatchObject({ ok: true, note: expect.stringContaining('rate-limited') });
  });
  it('rejects a key the provider refuses', async () => {
    const r = await validateKey(groq, creds, fakeFetch(() => new Response('{}', { status: 401 })).fn);
    expect(r).toEqual({ ok: false, message: 'The provider rejected this key.' });
  });
  it('reports other failures', async () => {
    const r = await validateKey(groq, creds, fakeFetch(() => new Response('<html>down</html>', { status: 503 })).fn);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('down') });
  });
});
