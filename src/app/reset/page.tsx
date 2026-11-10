import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { MIN_PASSWORD, resetPassword, tokenValid } from '@/server/passwords';
import { PasswordInput } from '../password-input';

async function save(fd: FormData) {
  'use server';
  const token = String(fd.get('token') ?? '');
  const next = String(fd.get('next') ?? '');
  if (next !== String(fd.get('confirm') ?? '')) redirect(`/reset?token=${encodeURIComponent(token)}&e=mismatch`);
  const r = await resetPassword(getDb(), token, next);
  if (r === 'ok') redirect('/login?reset=1');
  redirect(r === 'weak' ? `/reset?token=${encodeURIComponent(token)}&e=weak` : '/reset?e=link');
}

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string; e?: string }> }) {
  const { token, e } = await searchParams;
  const good = token ? await tokenValid(getDb(), token, 'reset') : false;
  return (
    <section className="mx-auto max-w-sm py-10">
      <div className="card card-pad space-y-5">
        <h1 className="h2">Choose a new password</h1>
        {!good ? (
          <p className="text-sm text-[var(--danger)]">This reset link has expired or was already used. <Link href="/forgot" className="underline">Ask for a new one</Link>.</p>
        ) : (
          <form action={save} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <PasswordInput name="next" required minLength={MIN_PASSWORD} maxLength={200} autoComplete="new-password" placeholder={`New password (${MIN_PASSWORD}+ characters)`} />
            <PasswordInput name="confirm" required minLength={MIN_PASSWORD} maxLength={200} autoComplete="new-password" placeholder="New password again" />
            {e && <p role="alert" className="text-sm text-[var(--danger)]">{e === 'mismatch' ? "The two passwords don't match." : `Use at least ${MIN_PASSWORD} characters.`}</p>}
            <button className="btn btn-primary w-full">Save new password</button>
          </form>
        )}
      </div>
    </section>
  );
}
