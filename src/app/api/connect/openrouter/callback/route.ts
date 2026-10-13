import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { handleOpenRouterCallback } from '@/server/oauth';

export async function GET(req: Request) {
  const uid = await sessionUserId();
  if (!uid) redirect('/login');

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const jar = await cookies();
  const verifier = jar.get('or_verifier')?.value;
  const savedState = jar.get('or_state')?.value;
  jar.delete('or_verifier');
  jar.delete('or_state');

  if (!code || !verifier || !state || state !== savedState) {
    redirect('/connect?error=' + encodeURIComponent('OpenRouter sign-in could not be verified. Please try again.'));
  }

  const r = await handleOpenRouterCallback(uid, { code, verifier }, getDeps());
  redirect(r.ok ? '/connect?connected=openrouter' : '/connect?error=' + encodeURIComponent(r.message));
}
