import { z } from 'zod';
import { loadCredentials } from '@/keys/service';
import { resolveUserId } from '@/server/identity';
import { getDeps } from '@/server/deps';
import { searchWeb } from '@/web/search';

const schema = z.object({ query: z.string().trim().min(1).max(400) });

/** Browser session or an ft_ token (V-Run's agent searches through here when you've connected Tavily). */
export async function POST(req: Request) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'A search query is required.' }, { status: 400 });

  const deps = getDeps();
  const creds = await loadCredentials(deps.db, uid, deps.vaultKey);
  const tavily = creds.get('tavily');
  if (!tavily) {
    return Response.json({ error: 'Connect a free Tavily key on the Connect page to search the web.' }, { status: 400 });
  }

  try {
    const result = await searchWeb(parsed.data.query, tavily.creds.key, {}, deps.fetchImpl);
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Search failed. Please try again.' }, { status: 502 });
  }
}
