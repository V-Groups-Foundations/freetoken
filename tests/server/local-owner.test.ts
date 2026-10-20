import { describe, it, expect } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { TEST_VAULT_KEY } from '../helpers/fixtures';
import { saveKey } from '@/keys/service';
import { localOwner } from '@/server/local-login';

describe('localOwner (no-password sign-in on this computer)', () => {
  it('creates the account when there is none', async () => {
    const db = await createTestDb();
    expect((await localOwner(db)).email).toBe('you@this-computer.local');
  });

  it('picks the account that has the provider keys, not just the oldest one', async () => {
    const db = await createTestDb();
    const empty = await createUser(db);
    const real = await createUser(db);
    expect((await localOwner(db)).id).toBe(empty.id); // nobody has keys yet: the oldest
    await saveKey(db, real.id, 'groq', 'gsk_mine', null, TEST_VAULT_KEY);
    expect((await localOwner(db)).id).toBe(real.id);
  });
});
