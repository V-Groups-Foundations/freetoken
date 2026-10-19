import { resolveUserId } from '@/server/identity';
import { getDeps } from '@/server/deps';
import { getUsageSummary } from '@/usage/summary';

/** Browser session or an ft_ token (V-Run's FreeToken hub shows the same numbers). */
export async function GET(req: Request) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  return Response.json(await getUsageSummary(uid, getDeps()));
}
