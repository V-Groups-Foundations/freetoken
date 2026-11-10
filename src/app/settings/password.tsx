import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { requireUserId } from '@/lib/session';
import { MIN_PASSWORD, setPassword } from '@/server/passwords';
import { PasswordInput } from '../password-input';

/** Signed in with the private sign-in link (the QR code): that's enough to reset a forgotten password. */
async function viaPrivateLink() {
  const s = (await auth()) as { via?: string } | null;
  return s?.via === 'local';
}

async function savePassword(fd: FormData) {
  'use server';
  const uid = await requireUserId();
  const next = String(fd.get('next') ?? '');
  if (next !== String(fd.get('confirm') ?? '')) redirect('/settings?pw=mismatch#password');
  const problem = await setPassword(getDb(), uid, String(fd.get('current') ?? ''), next, await viaPrivateLink());
  redirect(`/settings?pw=${problem ? (problem.includes('current') ? 'wrong' : 'weak') : 'saved'}#password`);
}

const NOTES: Record<string, [string, boolean]> = {
  saved: ['Password saved — sign in with your email and this password on any device.', true],
  wrong: ['Your current password is wrong.', false],
  weak: [`Use at least ${MIN_PASSWORD} characters.`, false],
  mismatch: ["The two new passwords don't match.", false],
};

/** Set (first time) or change the password for signing in with email on other devices. */
export async function PasswordCard({ status }: { status?: string }) {
  const uid = await requireUserId();
  const [me] = await getDb().select({ email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, uid));
  const has = Boolean(me?.passwordHash);
  const recovery = has && (await viaPrivateLink());
  const note = status ? NOTES[status] : undefined;
  return (
    <div id="password" className="card card-pad scroll-mt-6 space-y-4">
      <div>
        <span className="eyebrow">account</span>
        <h2 className="h2 mt-2">Password</h2>
        <p className="muted mt-1 text-sm">
          {has ? 'Change the password you sign in with' : 'Set a password so you can sign in with your email on any device'}
          {me?.email && <> — <span className="font-medium text-[var(--ink)]">{me.email}</span></>}.
        </p>
      </div>
      <form action={savePassword} className="grid gap-3 sm:max-w-sm">
        {has && !recovery && <PasswordInput name="current" required autoComplete="current-password" placeholder="Current password" />}
        {recovery && <p className="faint text-xs">You signed in with your private link, so you can set a new password without the old one.</p>}
        <PasswordInput name="next" required minLength={MIN_PASSWORD} maxLength={200} autoComplete="new-password" placeholder={`New password (${MIN_PASSWORD}+ characters)`} />
        <PasswordInput name="confirm" required minLength={MIN_PASSWORD} maxLength={200} autoComplete="new-password" placeholder="New password again" />
        {note && <p role="status" className={`text-sm ${note[1] ? 'text-[var(--success,#3fb950)]' : 'text-[var(--danger)]'}`}>{note[0]}</p>}
        <button className="btn btn-primary">{has ? 'Change password' : 'Set password'}</button>
      </form>
    </div>
  );
}
