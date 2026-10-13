import { randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionUserId } from '@/lib/session';
import { buildAuthUrl, makePkce } from '@/server/oauth';

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) redirect('/login');

  const { verifier, challenge } = await makePkce();
  const state = randomBytes(16).toString('hex');

  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const callbackUrl = `${proto}://${h.get('host')}/api/connect/openrouter/callback`;

  const jar = await cookies();
  const opts = { httpOnly: true, sameSite: 'lax' as const, secure: proto === 'https', path: '/', maxAge: 600 };
  jar.set('or_verifier', verifier, opts);
  jar.set('or_state', state, opts);

  redirect(buildAuthUrl(callbackUrl, challenge, state));
}
