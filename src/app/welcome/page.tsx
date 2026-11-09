import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { sessionUserId } from '@/lib/session';
import { localLoginMatches } from '@/server/local-login';
import { safeNext } from '@/server/phone';
import { AutoSubmit } from './auto-submit';

const NEXT = '/connect?welcome=1';

/**
 * The link `npm run dev` opens: signs you in on this computer, no password. The phone's QR code is the
 * same link at the computer's Wi-Fi address, with `to=` so the phone lands on a page made for it.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ t?: string; to?: string }> }) {
  const { t, to } = await searchParams;
  const next = safeNext(to, NEXT);
  if (await sessionUserId()) redirect(next);
  if (!localLoginMatches(t)) redirect('/login?error=link');

  async function enter(fd: FormData) {
    'use server';
    try {
      await signIn('local', { token: String(fd.get('t') ?? ''), redirectTo: next });
    } catch (e) {
      if (e instanceof AuthError) redirect('/login?error=link');
      throw e; // the redirect itself
    }
  }

  return (
    <section className="mx-auto flex max-w-sm flex-col items-center gap-4 py-24 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- brand mark */}
      <img src="/brand/freetoken.png" alt="" width={64} height={64} className="h-16 w-16 rounded-2xl" />
      <h1 className="h2">Signing you in…</h1>
      <AutoSubmit action={enter} token={t!} />
    </section>
  );
}
