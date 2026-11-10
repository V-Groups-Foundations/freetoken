import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, createUser } from '../helpers/db';
import { users } from '@/db/schema';
import { attempts, checkPassword, hashPassword, setPassword, signUp, verifyPassword } from '@/server/passwords';

describe('email + password accounts', () => {
  it('hashes with a salt and verifies only the right password', async () => {
    const a = await hashPassword('correct horse');
    expect(a).not.toContain('correct horse');
    expect(a).not.toBe(await hashPassword('correct horse'));
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('wrong horse', a)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });

  it('signs up once; the same email and password reach the same account every time', async () => {
    const db = await createTestDb();
    const r = await signUp(db, '  Me@Example.com ', 'longenough1', 'Me');
    expect(r.ok).toBe(true);
    const first = await checkPassword(db, 'me@example.com', 'longenough1');
    const again = await checkPassword(db, 'ME@example.com', 'longenough1');
    expect(first?.id).toBe(r.ok && r.userId);
    expect(again?.id).toBe(first?.id);
    expect(await checkPassword(db, 'me@example.com', 'nope-nope')).toBeNull();
    expect(await signUp(db, 'me@example.com', 'another-pass')).toEqual({ ok: false, error: 'taken' });
  });

  it("refuses bad input and never puts a password on someone's existing account", async () => {
    const db = await createTestDb();
    expect(await signUp(db, 'not-an-email', 'longenough1')).toEqual({ ok: false, error: 'email' });
    expect(await signUp(db, 'a@b.co', 'short')).toEqual({ ok: false, error: 'short' });
    const owner = await createUser(db, 'owner@example.com');
    expect(await signUp(db, 'owner@example.com', 'attacker-pass')).toEqual({ ok: false, error: 'unclaimed' });
    const [row] = await db.select().from(users).where(eq(users.id, owner.id));
    expect(row.passwordHash).toBeNull();
    expect(await checkPassword(db, 'owner@example.com', 'attacker-pass')).toBeNull();
  });

  it('the signed-in owner sets a password; changing it needs the current one', async () => {
    const db = await createTestDb();
    const me = await createUser(db, 'keys@example.com');
    expect(await setPassword(db, me.id, '', 'first-password')).toBeNull();
    expect((await checkPassword(db, 'keys@example.com', 'first-password'))?.id).toBe(me.id);
    expect(await setPassword(db, me.id, 'guess', 'second-password')).toMatch(/current/);
    expect(await setPassword(db, me.id, 'first-password', 'tiny')).toMatch(/at least/);
    expect(await setPassword(db, me.id, 'first-password', 'second-password')).toBeNull();
    expect(await checkPassword(db, 'keys@example.com', 'first-password')).toBeNull();
    // forgot it: a session from the private sign-in link may reset it without the old one
    expect(await setPassword(db, me.id, '', 'third-password', true)).toBeNull();
    expect((await checkPassword(db, 'keys@example.com', 'third-password'))?.id).toBe(me.id);
  });

  it('counts down the tries left, pauses at none, and a right password or a new one resets the count', async () => {
    const db = await createTestDb();
    await signUp(db, 'slow@example.com', 'the-real-one');
    expect(await attempts(db, 'slow@example.com')).toEqual({ left: 5, waitMinutes: 0 });
    await checkPassword(db, 'slow@example.com', 'guess-0');
    await checkPassword(db, 'Slow@example.com', 'guess-1');
    expect((await attempts(db, 'slow@example.com')).left).toBe(3);
    expect((await checkPassword(db, 'slow@example.com', 'the-real-one'))?.email).toBe('slow@example.com');
    expect((await attempts(db, 'slow@example.com')).left).toBe(5);
    for (let i = 0; i < 5; i++) await checkPassword(db, 'slow@example.com', `guess-${i}`);
    expect(await attempts(db, 'slow@example.com')).toEqual({ left: 0, waitMinutes: 15 });
    expect(await checkPassword(db, 'slow@example.com', 'the-real-one')).toBeNull();
    // fifteen minutes later the tries are back
    expect((await attempts(db, 'slow@example.com', Date.now() + 15 * 60_000 + 1000)).left).toBe(5);
    // the signed-in owner setting a new password starts fresh
    const [u] = await db.select().from(users).where(eq(users.email, 'slow@example.com'));
    expect(await setPassword(db, u.id, 'the-real-one', 'brand-new-one')).toBeNull();
    expect((await attempts(db, 'slow@example.com')).left).toBe(5);
  });
});
