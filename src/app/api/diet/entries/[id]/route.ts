import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { deleteEntry } from '@/diet/service';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return Response.json({ error: 'Bad id.' }, { status: 400 });
  return (await deleteEntry(getDb(), uid, id)) ? Response.json({ ok: true }) : Response.json({ error: 'Not found.' }, { status: 404 });
}
