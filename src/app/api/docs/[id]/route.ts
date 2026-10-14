import { deleteDocument } from '@/rag/service';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const { id } = await params;
  const ok = await deleteDocument(getDeps().db, uid, id);
  if (!ok) return Response.json({ error: { message: 'Document not found.' } }, { status: 404 });
  return Response.json({ ok: true });
}
