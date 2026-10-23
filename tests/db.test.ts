import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, createUser } from './helpers/db';
import { usageEvents, users } from '@/db/schema';
import { healLocalTimestamps } from '@/db';

describe('database', () => {
  it('migrates and stores users', async () => {
    const db = await createTestDb();
    const u = await createUser(db, 'a@test.dev');
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.email).toBe('a@test.dev');
    expect(row.role).toBe('user');
  });

  it("stamps rows in UTC whatever the computer's time zone (a Japan PC stamped them 9 hours ahead)", async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    await db.insert(usageEvents).values({ userId: u.id, provider: 'p', modelId: 'm', source: 'api', status: 'ok' });
    const [ev] = await db.select().from(usageEvents);
    expect(Math.abs(ev.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it('moves rows stamped in local time (before UTC) back from the future, once', async () => {
    const db = await createTestDb();
    const u = await createUser(db);
    const local = new Date(Date.now() + 9 * 3600_000); // how a JST computer stamped "now"
    await db.insert(usageEvents).values([
      { userId: u.id, provider: 'p', modelId: 'future', source: 'api', status: 'error', createdAt: local },
      { userId: u.id, provider: 'p', modelId: 'past', source: 'api', status: 'error', createdAt: new Date(Date.now() - 3600_000) },
    ]);
    await healLocalTimestamps(db, 540);
    await healLocalTimestamps(db, 540); // again: nothing left in the future, so nothing moves
    const rows = new Map((await db.select().from(usageEvents)).map((r) => [r.modelId, r.createdAt.getTime()]));
    expect(Math.abs(rows.get('future')! - Date.now())).toBeLessThan(60_000);
    expect(Math.abs(rows.get('past')! - (Date.now() - 3600_000))).toBeLessThan(60_000);
  });
});
