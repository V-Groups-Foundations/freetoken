import { z } from 'zod';
import { loadCredentials } from '@/keys/service';
import { editImageCloudflare, MAX_EDIT_IMAGES, MAX_IMAGE_BYTES, parseImageDataUrl } from '@/images/cloudflare';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { dataUrlBytes, saveImage } from '@/images/gallery';

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  images: z.array(z.string().max(Math.ceil(MAX_IMAGE_BYTES * 1.4))).min(1).max(MAX_EDIT_IMAGES),
  width: z.number().int().positive().max(10_000).optional(),
  height: z.number().int().positive().max(10_000).optional(),
});

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { message: `An instruction (1–2000 characters) and 1–${MAX_EDIT_IMAGES} pictures are required.` } }, { status: 400 });
  }
  const images = parsed.data.images.map(parseImageDataUrl);
  if (images.some((i) => !i)) return Response.json({ error: { message: 'One of the pictures could not be read — use a JPEG, PNG or WebP under 8 MB.' } }, { status: 400 });

  const deps = getDeps();
  const cf = (await loadCredentials(deps.db, uid, deps.vaultKey)).get('cloudflare');
  if (!cf) return Response.json({ error: { message: 'Editing pictures uses your free Cloudflare allowance — connect Cloudflare at /connect first.' } }, { status: 400 });

  const result = await editImageCloudflare(
    { prompt: parsed.data.prompt, images: images as { bytes: Uint8Array; type: string }[], width: parsed.data.width, height: parsed.data.height },
    { key: cf.creds.key, accountId: cf.creds.extra },
    { fetchImpl: deps.fetchImpl },
  );
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
  const bytes = dataUrlBytes(result.dataUrl);
  const id = bytes
    ? await saveImage(deps.db, { userId: uid, prompt: parsed.data.prompt, kind: 'edit', engine: 'cloudflare', bytes }).catch((e) => { console.error('[images] saving to the gallery failed', e); return null; })
    : null;
  return Response.json({ dataUrl: result.dataUrl, id });
}
