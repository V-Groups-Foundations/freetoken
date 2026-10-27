import { z } from 'zod';
import { loadCredentials } from '@/keys/service';
import { generateImage } from '@/images/generate';
import { generateImageGemini } from '@/images/gemini';
import { generateImageCloudflare } from '@/images/cloudflare';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { dataUrlBytes, saveImage } from '@/images/gallery';

/** Keeps the picture in the user's gallery; a failed save still returns the picture. */
async function saved(uid: string, prompt: string, engine: string, dataUrl: string) {
  const bytes = dataUrlBytes(dataUrl);
  const id = bytes ? await saveImage(getDeps().db, { userId: uid, prompt, kind: 'create', engine, bytes }).catch((e) => { console.error('[images] saving to the gallery failed', e); return null; }) : null;
  return Response.json({ dataUrl, id });
}

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  engine: z.enum(['pollinations', 'gemini', 'cloudflare']).optional(),
  model: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'A prompt (1–2000 characters) is required.' } }, { status: 400 });

  const deps = getDeps();

  if (parsed.data.engine === 'gemini') {
    const gemini = (await loadCredentials(deps.db, uid, deps.vaultKey)).get('gemini');
    if (!gemini) return Response.json({ error: { message: 'Connect Gemini at /connect to use the Gemini engine.' } }, { status: 400 });
    const result = await generateImageGemini({ prompt: parsed.data.prompt }, gemini.creds.key, { fetchImpl: deps.fetchImpl });
    if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
    return saved(uid, parsed.data.prompt, 'gemini', result.dataUrl);
  }

  if (parsed.data.engine === 'cloudflare') {
    const cf = (await loadCredentials(deps.db, uid, deps.vaultKey)).get('cloudflare');
    if (!cf) return Response.json({ error: { message: 'Connect Cloudflare at /connect to use the Cloudflare engine.' } }, { status: 400 });
    const result = await generateImageCloudflare({ prompt: parsed.data.prompt }, { key: cf.creds.key, accountId: cf.creds.extra }, { fetchImpl: deps.fetchImpl });
    if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
    return saved(uid, parsed.data.prompt, 'cloudflare', result.dataUrl);
  }

  // Default engine: keyless Pollinations (free FLUX/Turbo) — no provider needed.
  const result = await generateImage({ prompt: parsed.data.prompt, model: parsed.data.model }, { fetchImpl: deps.fetchImpl });
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
  return saved(uid, parsed.data.prompt, 'pollinations', result.dataUrl);
}
