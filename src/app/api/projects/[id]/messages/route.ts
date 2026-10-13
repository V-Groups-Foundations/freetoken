import { getDb } from '@/db';
import { getProject, listMessages } from '@/projects/service';
import { resolveUserId } from '@/server/identity';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  const project = await getProject(getDb(), uid, id);
  if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });
  return Response.json({ project: { id: project.id, name: project.name, model: project.model }, messages: await listMessages(getDb(), id) });
}
