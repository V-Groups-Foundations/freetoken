import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { emailEnabled, linkEmail, sendEmail } from '@/server/email';
import { attempts, issueToken, noteFailure, normalizeEmail, validEmail } from '@/server/passwords';
import { clientIp, siteUrl } from '@/server/site';

async function requestReset(fd: FormData) {
  'use server';
  const email = normalizeEmail(fd.get('email'));
  const db = getDb();
  // a few requests per network per 15 minutes, so the form can't be used to flood someone's inbox
  const key = `reset:${await clientIp()}`;
  if ((await attempts(db, key)).left <= 2) redirect('/forgot?sent=1');
  await noteFailure(db, key);
  if (validEmail(email) && emailEnabled()) {
    const [u] = await db.select({ id: users.id, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email));
    if (u?.passwordHash) {
      const link = `${await siteUrl()}/reset?token=${await issueToken(db, u.id, 'reset')}`;
      const m = linkEmail('Reset your password', 'Someone (hopefully you) asked to reset the password for your FreeToken account. The link works once, for one hour.', 'Choose a new password', link, 'If you did not ask for this, ignore this email; your password stays the same.');
      const sent = await sendEmail(email, 'Reset your FreeToken password', m.text, m.html);
      if (!sent.ok) console.error('forgot: reset email failed', sent.error);
    }
  }
  // the same answer whether or not the account exists, so the form doesn't reveal who has one
  redirect('/forgot?sent=1');
}

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams;
  return (
    <section className="mx-auto max-w-sm py-10">
      <div className="card card-pad space-y-5">
        <div>
          <h1 className="h2">Forgot your password?</h1>
          <p className="muted mt-1 text-sm">Enter your account&apos;s email and we&apos;ll send you a link to choose a new one.</p>
        </div>
        {!emailEnabled() ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
            This FreeToken can&apos;t send email yet, so resets by email are off. Ask the person who runs it to reset your password, or, if you have the private sign-in link, open it and set a new password under API → Password.
          </p>
        ) : sent ? (
          <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">If there&apos;s an account with that email, a reset link is on its way. It works once, for one hour. Check your spam folder too.</p>
        ) : (
          <form action={requestReset} className="space-y-3">
            <input name="email" type="email" required autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="you@example.com" className="input" />
            <button className="btn btn-primary w-full">Send reset link</button>
          </form>
        )}
        <p className="muted text-center text-sm"><Link href="/login" className="underline">Back to sign in</Link></p>
      </div>
    </section>
  );
}
