import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { getUsageSummary } from '@/usage/summary';

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  return Response.json(await getUsageSummary(uid, getDeps()));
}
