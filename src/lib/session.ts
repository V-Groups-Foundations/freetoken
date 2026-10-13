import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getDb } from '@/db';
import { users } from '@/db/schema';

/** The signed-in user's id, or null. A session whose user row is gone counts as signed out. */
export async function sessionUserId(): Promise<string | null> {
  const id = (await auth())?.user?.id;
  if (!id) return null;
  const [row] = await getDb().select({ id: users.id }).from(users).where(eq(users.id, id));
  return row ? id : null;
}

export async function requireUserId(): Promise<string> {
  const id = await sessionUserId();
  if (!id) redirect('/login');
  return id;
}
