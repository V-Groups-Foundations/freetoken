import { z } from 'zod';
import { getDb } from '@/db';
import { addMessage, getProject, listMessages, setProjectModel } from '@/projects/service';
import { persistAssistant } from '@/projects/stream';
import { routeChat } from '@/router/execute';
import { resolveUserId } from '@/server/identity';
import { getDeps } from '@/server/deps';

const MAX_HISTORY = 100;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const project = await getProject(db, uid, id);
  if (!project) return Response.json({ error: { message: 'Project not found.' } }, { status: 404 });

  const body = z.object({ content: z.string().trim().min(1).max(100_000) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: { message: 'Message is required.' } }, { status: 400 });

  // Shared memory: the model sees the whole saved conversation, not just this message.
  const history = (await listMessages(db, id)).slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
  await addMessage(db, id, { role: 'user', content: body.data.content });

  const out = await routeChat(
    { userId: uid, source: 'chat', body: { model: project.model, messages: [...history, { role: 'user', content: body.data.content }], stream: true } },
    getDeps(),
  );
  if (!out.ok) return Response.json({ error: { message: out.message, code: out.code } }, { status: out.status });

  const provider = out.response.headers.get('x-freetoken-provider');
  const persisted = out.response.body
    ? persistAssistant(out.response.body, db, id, provider)
    : null;
  return new Response(persisted, { status: 200, headers: out.response.headers });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await resolveUserId(req);
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const { id } = await params;
  const p = z.object({ model: z.string().min(1).max(100) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Invalid model.' }, { status: 400 });
  await setProjectModel(getDb(), uid, id, p.data.model);
  return Response.json({ ok: true });
}
