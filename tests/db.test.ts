import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, createUser } from './helpers/db';
import { users } from '@/db/schema';

describe('database', () => {
  it('migrates and stores users', async () => {
    const db = await createTestDb();
    const u = await createUser(db, 'a@test.dev');
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.email).toBe('a@test.dev');
    expect(row.role).toBe('user');
  });
});
