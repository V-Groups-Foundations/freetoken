import { loadCredentials } from '@/keys/service';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { ocrImage } from '@/ocr/ocrspace';

const MAX_OCR_BYTES = 1024 * 1024; // OCR.space free tier: 1 MB per file

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return Response.json({ error: { message: 'An image file is required.' } }, { status: 400 });
  }
  if (file.size > MAX_OCR_BYTES) {
    return Response.json({ error: { message: 'Image is too large for OCR (max 1 MB on the free tier).' } }, { status: 400 });
  }

  const deps = getDeps();
  const ocr = (await loadCredentials(deps.db, uid, deps.vaultKey)).get('ocrspace');
  if (!ocr) {
    return Response.json({ error: { message: 'Connect a free OCR.space key at /connect to read images.', code: 'no_ocr' } }, { status: 400 });
  }

  const filename = file instanceof File && file.name ? file.name : 'image.png';
  const result = await ocrImage(ocr.creds.key, file, filename, deps.fetchImpl);
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
  return Response.json({ text: result.text });
}
