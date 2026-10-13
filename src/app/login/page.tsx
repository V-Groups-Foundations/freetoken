import { redirect } from 'next/navigation';
import { devLoginEnabled, signIn } from '@/auth';
import { sessionUserId } from '@/lib/session';

export default async function LoginPage() {
  if (await sessionUserId()) redirect('/connect');
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
        {!google && !devLoginEnabled && <p className="text-sm text-[var(--danger)]">No sign-in method is configured.</p>}
      </div>
    </section>
  );
}
