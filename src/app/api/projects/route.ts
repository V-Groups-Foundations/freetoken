import { z } from 'zod';
import { getDb } from '@/db';
import { createProject, deleteProject, listProjects } from '@/projects/service';
import { resolveUserId } from '@/server/identity';

const unauthorized = () => Response.json({ error: 'Sign in first.' }, { status: 401 });

export async function GET(req: Request) {
  const uid = await resolveUserId(req);
  if (!uid) return unauthorized();
  return Response.json(await listProjects(getDb(), uid));
}

export async function POST(req: Request) {
  const uid = await resolveUserId(req);
  if (!uid) return unauthorized();
  const p = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: 'Give the project a name.' }, { status: 400 });
  return Response.json(await createProject(getDb(), uid, p.data.name));
}

export async function DELETE(req: Request) {
  const uid = await resolveUserId(req);
  if (!uid) return unauthorized();
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'id is required.' }, { status: 400 });
  await deleteProject(getDb(), uid, id);
  return Response.json({ ok: true });
}
