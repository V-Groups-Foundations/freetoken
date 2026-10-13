import { redirect } from 'next/navigation';
import { auth } from '@/auth';

export async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function requireUserId(): Promise<string> {
  const id = await sessionUserId();
  if (!id) redirect('/login');
  return id;
}
