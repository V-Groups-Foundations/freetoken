import { listImages } from '@/images/gallery';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  return Response.json({ images: await listImages(getDeps().db, uid) });
}
