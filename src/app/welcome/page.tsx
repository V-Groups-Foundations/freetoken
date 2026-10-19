import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { signIn } from '@/auth';
import { sessionUserId } from '@/lib/session';
import { localLoginMatches } from '@/server/local-login';
import { AutoSubmit } from './auto-submit';

const NEXT = '/connect?welcome=1';

/** The link `npm run dev` opens: signs you in on this computer, no password. */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (await sessionUserId()) redirect(NEXT);
  const { t } = await searchParams;
  if (!localLoginMatches(t)) redirect('/login?error=link');

  async function enter(fd: FormData) {
    'use server';
    try {
      await signIn('local', { token: String(fd.get('t') ?? ''), redirectTo: NEXT });
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
