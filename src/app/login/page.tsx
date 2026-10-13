import { redirect } from 'next/navigation';
import { auth, devLoginEnabled, signIn } from '@/auth';

export default async function LoginPage() {
  if ((await auth())?.user) redirect('/connect');
  const google = Boolean(process.env.AUTH_GOOGLE_ID);
  return (
    <section className="mx-auto max-w-sm space-y-6 py-12">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      {google && (
        <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/connect' }); }}>
          <button className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-white">Continue with Google</button>
        </form>
      )}
      {devLoginEnabled && (
        <form
          className="space-y-2 rounded-lg border border-dashed p-4"
          action={async (fd: FormData) => { 'use server'; await signIn('dev', { email: fd.get('email'), redirectTo: '/connect' }); }}
        >
          <p className="text-xs text-neutral-500">Development login (disabled in production)</p>
          <input name="email" type="email" required placeholder="you@example.com" className="w-full rounded border px-3 py-2" />
          <button className="w-full rounded-lg border px-4 py-2">Sign in (dev)</button>
        </form>
      )}
      {!google && !devLoginEnabled && <p className="text-sm text-red-600">No sign-in method is configured.</p>}
    </section>
  );
}
