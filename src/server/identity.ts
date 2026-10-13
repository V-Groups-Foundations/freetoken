import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { userIdFromBearer } from './tokens';

/**
 * Resolve the acting user from either a browser session or an ft_ bearer token,
 * so project routes work from the web app and the CLI alike.
 */
export async function resolveUserId(req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization');
  if (auth) {
    const fromToken = await userIdFromBearer(getDb(), auth);
    if (fromToken) return fromToken;
  }
  return sessionUserId();
}
