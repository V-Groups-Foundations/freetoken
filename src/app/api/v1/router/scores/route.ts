import { resolveUserId } from '@/server/identity';
import { getDeps } from '@/server/deps';
import { routerScores } from '@/server/router-scores';

/** GET ?task=agent — how auto routing ranks the user's models for that kind of task (browser session or ft_ token). */
export async function GET(req: Request) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  return Response.json(await routerScores(getDeps(), uid, new URL(req.url).searchParams.get('task')));
}
