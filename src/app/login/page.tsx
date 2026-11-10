import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { devLoginEnabled, signIn } from '@/auth';
import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { onOwnComputer } from '@/server/local-login';
import { MAX_TRIES, MIN_PASSWORD, SIGNUP_ERRORS, attempts, issueToken, noteSignup, signUp, signupAllowed, type SignUpError } from '@/server/passwords';
import { emailEnabled, linkEmail, sendEmail } from '@/server/email';
import { clientIp, siteUrl } from '@/server/site';
import { PasswordInput } from '../password-input';

async function signInWithPassword(fd: FormData) {
  'use server';
  try {
    await signIn('password', { email: fd.get('email'), password: fd.get('password'), redirectTo: '/connect' });
  } catch (e) {
    if (e instanceof AuthError) {
      // only counts go in the address, never the email
      const { left, waitMinutes } = await attempts(getDb(), fd.get('email'));
      redirect(left > 0 ? `/login?error=wrong&left=${left}` : `/login?error=locked&wait=${waitMinutes}`);
    }
    throw e; // the redirect after a successful sign-in
  }
}

async function createAccount(fd: FormData) {
  'use server';
  const password = String(fd.get('password') ?? '');
  const db = getDb();
  const ip = await clientIp();
  if (!(await signupAllowed(db, ip))) redirect('/login?mode=signup&error=busy');
  const r = await signUp(db, fd.get('email'), password, fd.get('name'));
  if (!r.ok) redirect(`/login?mode=signup&error=${r.error}`);
  await noteSignup(db, ip);
  // confirm the address when this site can send email (signing in doesn't wait for it)
  if (emailEnabled()) {
    const link = `${await siteUrl()}/verify?token=${await issueToken(db, r.userId, 'verify')}`;
    const m = linkEmail('Confirm your email', 'Thanks for creating a FreeToken account. Confirm this is your address so you can reset your password by email if you ever forget it.', 'Confirm email', link, 'If you did not create this account, ignore this email.');
    const sent = await sendEmail(String(fd.get('email')).trim().toLowerCase(), 'Confirm your FreeToken email', m.text, m.html);
    if (!sent.ok) console.error('signup: verification email failed', sent.error);
  }
  await signIn('password', { email: fd.get('email'), password, redirectTo: '/connect?welcome=1' });
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; mode?: string; left?: string; wait?: string; reset?: string }> }) {
  if (await sessionUserId()) redirect('/connect');
  const { error, mode, left, wait, reset } = await searchParams;
  const n = (v: string | undefined, max: number) => Math.min(max, Math.max(0, Math.floor(Number(v)) || 0));
  const signup = mode === 'signup';
  const local = onOwnComputer();
  const google = Boolean(process.env.AUTH_GOOGLE_ID);
  const message = signup
    ? (error && error in SIGNUP_ERRORS ? SIGNUP_ERRORS[error as SignUpError] : null)
    : error === 'wrong' ? `Wrong email or password — ${n(left, MAX_TRIES)} ${n(left, MAX_TRIES) === 1 ? 'try' : 'tries'} left before a 15-minute wait.`
    : error === 'locked' ? `Too many wrong tries. Try again in ${n(wait, 15) || 1} minute${n(wait, 15) === 1 ? '' : 's'}.`
    : null;
  return (
    <section className="mx-auto max-w-sm py-10">
      <div className="card card-pad space-y-6">
        <div>
          <h1 className="h2">{signup ? 'Create your account' : 'Sign in'}</h1>
          <p className="muted mt-1 text-sm">
            {signup ? 'Your API keys, chats and diet log are saved to this account — sign in anywhere to get them back.'
              : 'Your keys, chats and diet log, on any device.'}
          </p>
        </div>

        <form action={signup ? createAccount : signInWithPassword} className="space-y-3">
          {signup && (
            <label className="block space-y-1 text-sm">
              <span className="muted">Name <span className="faint">(optional)</span></span>
              <input name="name" autoComplete="name" maxLength={80} className="input" />
            </label>
          )}
          <label className="block space-y-1 text-sm">
            <span className="muted">Email</span>
            <input name="email" type="email" required autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="input" />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="muted">Password{signup && <span className="faint"> (at least {MIN_PASSWORD} characters)</span>}</span>
            <PasswordInput name="password" required minLength={signup ? MIN_PASSWORD : 1} maxLength={200}
              autoComplete={signup ? 'new-password' : 'current-password'} />
          </label>
          {reset && !message && <p role="status" className="text-sm text-[var(--success,#3ccf91)]">Password changed. Sign in with the new one.</p>}
          {message && <p role="alert" className="text-sm text-[var(--danger)]">{message}</p>}
          <button className="btn btn-primary w-full">{signup ? 'Create account' : 'Sign in'}</button>
          {!signup && <p className="text-right text-xs"><Link href="/forgot" className="muted underline">Forgot password?</Link></p>}
        </form>

        <p className="muted text-center text-sm">
          {signup
            ? <>Already have an account? <Link href="/login" className="underline">Sign in</Link></>
            : <>New here? <Link href="/login?mode=signup" className="underline">Create an account</Link></>}
        </p>

        {google && (
          <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/connect' }); }}>
            <button className="btn btn-secondary w-full">Continue with Google</button>
          </form>
        )}
        {devLoginEnabled && (
          <form
            className="space-y-3 rounded-xl border border-dashed border-[var(--border-strong)] p-4"
            action={async (fd: FormData) => { 'use server'; await signIn('dev', { email: fd.get('email'), redirectTo: '/connect' }); }}
          >
            <p className="faint text-xs">Development login — disabled in production</p>
            <input name="email" type="email" required placeholder="you@example.com" className="input" />
            <button className="btn btn-secondary w-full">Sign in</button>
          </form>
        )}
        {local && (
          <div className="space-y-1.5 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm">
            <div className="font-medium">On your own computer? No sign-in needed.</div>
            <p className="muted">
              Run <code className="rounded bg-[var(--surface)] px-1 font-mono text-xs">npm run dev</code> — it opens FreeToken already signed in.
              The link is also printed in that terminal.
            </p>
            {error === 'link' && <p className="text-[var(--danger)]">That sign-in link has expired (it changes each time FreeToken starts). Use the newest one.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
