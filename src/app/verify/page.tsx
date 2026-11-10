import Link from 'next/link';
import { getDb } from '@/db';
import { markVerified } from '@/server/passwords';

/** The link in the "confirm your email" message. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const ok = await markVerified(getDb(), token);
  return (
    <section className="mx-auto max-w-sm py-16 text-center">
      <div className="card card-pad space-y-3">
        <div className="text-3xl" aria-hidden>{ok ? '✅' : '⚠️'}</div>
        <h1 className="h2">{ok ? 'Email confirmed' : 'This link has expired or was already used'}</h1>
        <p className="muted text-sm">{ok ? 'You can reset your password by email if you ever forget it.' : 'Your account works anyway; this only matters for password resets.'}</p>
        <Link href="/connect" className="btn btn-primary">Open FreeToken</Link>
      </div>
    </section>
  );
}
