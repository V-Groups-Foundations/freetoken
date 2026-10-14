import { z } from 'zod';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { readUrl, normalizeUrl } from '@/web/read';

const schema = z.object({ url: z.string().trim().min(3).max(2000) });

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'A URL is required.' }, { status: 400 });

  try {
    normalizeUrl(parsed.data.url); // validate shape before the network call
  } catch {
    return Response.json({ error: 'That doesn’t look like a valid web address.' }, { status: 400 });
  }

  try {
    const result = await readUrl(parsed.data.url, getDeps().fetchImpl);
    return Response.json(result);
  } catch {
    return Response.json({ error: 'Could not read that URL.' }, { status: 502 });
  }
}
