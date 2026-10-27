import { deleteImage, readImage } from '@/images/gallery';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return new Response('Sign in first.', { status: 401 });
  const img = await readImage(getDeps().db, uid, (await params).id);
  if (!img) return new Response('Not found.', { status: 404 });
  return new Response(new Uint8Array(img.bytes), { headers: { 'content-type': img.type, 'cache-control': 'private, max-age=31536000, immutable' } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const ok = await deleteImage(getDeps().db, uid, (await params).id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: { message: 'Not found.' } }, { status: 404 });
}
