import { z } from 'zod';
import { getDb } from '@/db';
import { createToken } from '@/server/tokens';
import { localLoginMatches, localOwner } from '@/server/local-login';

/**
 * V-Run on the same computer connects itself: it proves it can read this install's sign-in token
 * (.data/local-login.token) and gets its own API token, revocable under API like any other.
 */
export async function POST(req: Request) {
  const p = z.object({ token: z.string().min(32).max(200), name: z.enum(['V-Run', 'CLI']).optional() }).safeParse(await req.json().catch(() => null));
  if (!p.success || !localLoginMatches(p.data.token)) return Response.json({ error: 'Not allowed.' }, { status: 403 });
  const db = getDb();
  const owner = await localOwner(db);
  return Response.json({ token: await createToken(db, owner.id, p.data.name ?? 'V-Run') });
}
