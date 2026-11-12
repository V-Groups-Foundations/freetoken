import { redirect } from 'next/navigation';
import { sessionUserId } from '@/lib/session';
import { SignInVRun } from './sign-in';

export const dynamic = 'force-dynamic';

/**
 * "Sign in with FreeToken" from the V-Run app: V-Run opens this page in the browser with a one-time
 * `state`; after sign-in, one click creates V-Run's token and hands it back through a vrun://connect link
 * carrying the same state (V-Run accepts only the state it made, so another site can't sign it in).
 */
export default async function VRunSignIn({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { state } = await searchParams;
  if (!state || !/^[A-Za-z0-9_-]{16,64}$/.test(state)) redirect('/v-run');
  if (!(await sessionUserId())) redirect(`/login?next=${encodeURIComponent(`/v-run/signin?state=${state}`)}`);
  return <SignInVRun state={state} />;
}
