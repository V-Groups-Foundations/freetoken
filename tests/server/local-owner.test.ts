import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import { saveKey } from '@/keys/service';
import { localOwner } from '@/server/local-login';

const pinFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-owner-')), 'local-owner');

describe('localOwner (no-password sign-in on this computer)', () => {
  it('creates the account when there is none', async () => {
    const db = await createTestDb();
    expect((await localOwner(db, pinFile())).email).toBe('you@this-computer.local');
  });

  it('picks the account that has the provider keys, not just the oldest one', async () => {
    const db = await createTestDb();
    const file = pinFile();
    const empty = await createUser(db);
    const real = await createUser(db);
    expect((await localOwner(db, file)).id).toBe(empty.id); // nobody has keys yet: the oldest (not pinned)
    await saveKey(db, real.id, 'groq', 'gsk_mine', null, TEST_VAULT_KEY);
    expect((await localOwner(db, file)).id).toBe(real.id);
  });

  it('once found, the owner stays the owner — another user adding more keys cannot take over', async () => {
    const db = await createTestDb();
    const file = pinFile();
    const owner = await createUser(db);
    await saveKey(db, owner.id, 'groq', 'gsk_owner', null, TEST_VAULT_KEY);
    expect((await localOwner(db, file)).id).toBe(owner.id);
    const other = await createUser(db);
    for (const p of ['gemini', 'cohere', 'openrouter']) await saveKey(db, other.id, p, `k_${p}`, null, TEST_VAULT_KEY);
    expect((await localOwner(db, file)).id).toBe(owner.id);
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(owner.id);
  });
});
