import { getDb } from '@/db';
import { z } from 'zod';
import { appendMessages, getProject, listMessages } from '@/projects/service';
import { resolveUserId } from '@/server/identity';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  const project = await getProject(getDb(), uid, id);
  if (!project) return Response.json({ error: 'Project not found.' }, { status: 404 });
  return Response.json({ project: { id: project.id, name: project.name, model: project.model }, messages: await listMessages(getDb(), id) });
}

const Append = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(200_000),
    provider: z.string().max(100).optional(),
  })).min(1).max(20),
});

/** Write turns made elsewhere (V-Run) into the project's shared conversation. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = Append.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'messages must be 1-20 {role, content} items.' }, { status: 400 });
  const { id } = await params;
  const rows = await appendMessages(getDb(), uid, id, body.data.messages);
  if (!rows) return Response.json({ error: 'Project not found.' }, { status: 404 });
  return Response.json({ added: rows.length });
}
