import { redirect } from 'next/navigation';
import { devLoginEnabled, signIn } from '@/auth';
import { sessionUserId } from '@/lib/session';
import { localLoginEnabled } from '@/server/local-login';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await sessionUserId()) redirect('/connect');
  const { error } = await searchParams;
  const local = localLoginEnabled();
  const google = Boolean(process.env.AUTH_GOOGLE_ID);
  return (
    <section className="mx-auto max-w-sm py-10">
      <div className="card card-pad space-y-6">
        <div>
          <h1 className="h2">Sign in</h1>
          <p className="muted mt-1 text-sm">Connect your free API keys and start using your pool.</p>
        </div>
        {google && (
          <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/connect' }); }}>
            <button className="btn btn-primary w-full">Continue with Google</button>
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
        {!google && !devLoginEnabled && !local && <p className="text-sm text-[var(--danger)]">No sign-in method is configured.</p>}
      </div>
    </section>
  );
}
