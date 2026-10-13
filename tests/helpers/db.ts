import { createDb, type DB } from '@/db';
import { runMigrations } from '@/db/migrations';
import { users } from '@/db/schema';

export async function createTestDb(): Promise<DB> {
  const db = createDb('pglite:');
  await runMigrations(db, 'pglite:');
  return db;
}

export async function createUser(db: DB, email = `u${crypto.randomUUID()}@test.dev`) {
  const [u] = await db.insert(users).values({ email }).returning();
  return u;
}
