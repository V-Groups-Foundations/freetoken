import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, createUser } from '../helpers/db';
import { users } from '@/db/schema';
import {
  checkPassword, issueToken, markVerified, noteSignup, redeemToken, resetPassword, setPassword, signupAllowed, tokenValid,
} from '@/server/passwords';
import { checkinDue, checkinPrompt } from '@/diet/checkin';

describe('sign-up limits', () => {
  it('allows 3 new accounts per network per 15 minutes', async () => {
    const db = await createTestDb();
    const now = Date.now();
    for (let i = 0; i < 3; i++) { expect(await signupAllowed(db, '203.0.113.7', now)).toBe(true); await noteSignup(db, '203.0.113.7', now); }
    expect(await signupAllowed(db, '203.0.113.7', now)).toBe(false);
    expect(await signupAllowed(db, '198.51.100.1', now)).toBe(true); // another network
    expect(await signupAllowed(db, '203.0.113.7', now + 16 * 60_000)).toBe(true); // later
  });
});

describe('one-time email links', () => {
  it('a reset link works once, within the hour, and only for resets', async () => {
    const db = await createTestDb();
    const u = await createUser(db, 'forgot@example.com');
    await setPassword(db, u.id, '', 'old-password');
    const now = Date.now();
    const token = await issueToken(db, u.id, 'reset', now);
    expect(await tokenValid(db, token, 'reset', now)).toBe(true);
    expect(await tokenValid(db, token, 'verify', now)).toBe(false);
    expect(await tokenValid(db, token, 'reset', now + 61 * 60_000)).toBe(false); // expired
    expect(await resetPassword(db, token, 'short')).toBe('weak');
    expect(await resetPassword(db, token, 'brand-new-password')).toBe('ok');
    expect((await checkPassword(db, 'forgot@example.com', 'brand-new-password'))?.id).toBe(u.id);
    expect(await resetPassword(db, token, 'another-password')).toBe('bad-link'); // used
    expect(await resetPassword(db, 'x'.repeat(43), 'another-password')).toBe('bad-link');
  });

  it('asking again cancels the older link; verification marks the email', async () => {
    const db = await createTestDb();
    const u = await createUser(db, 'v@example.com');
    const first = await issueToken(db, u.id, 'verify');
    const second = await issueToken(db, u.id, 'verify');
    expect(await redeemToken(db, first, 'verify')).toBeNull();
    expect(await markVerified(db, second)).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    expect(row.emailVerified).toBeInstanceOf(Date);
    expect(await markVerified(db, second)).toBe(false);
  });
});

describe('weekly check-in', () => {
  it('is due 7 days after the last one; the first waits for some data', () => {
    expect(checkinDue('2026-11-03', '2026-11-10', 0, 0)).toBe(true);
    expect(checkinDue('2026-11-05', '2026-11-10', 6, 3)).toBe(false);
    expect(checkinDue(null, '2026-11-10', 2, 1)).toBe(false);
    expect(checkinDue(null, '2026-11-10', 3, 0)).toBe(true);
    expect(checkinDue(null, '2026-11-10', 0, 2)).toBe(true);
  });
  it('the prompt carries the week and asks for concrete adjustments without logging', () => {
    const p = checkinPrompt({ advice: '  - weight trend -0.4 kg/week', targets: '2000 kcal · P 200', week: '2026-11-09 1950 kcal P180', weights: '2026-11-10 94', lifts: 'Bench press: 80×8 (11-08)', physique: '', plan: 'Upper/Lower 4-day' });
    for (const s of ['2000 kcal · P 200', '-0.4 kg/week', 'Bench press: 80×8', 'Upper/Lower 4-day', 'This week:', "Don't log anything"]) expect(p).toContain(s);
  });
});
