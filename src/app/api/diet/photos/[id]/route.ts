import { getDb } from '@/db';
import { sessionUserId } from '@/lib/session';
import { imageType } from '@/images/gallery';
import { deletePhoto, readPhoto } from '@/diet/service';
import { analyzePhoto } from '@/diet/analyze';
import { dayParam } from '@/diet/day';

export const maxDuration = 300;

async function photoId(params: Promise<{ id: string }>) {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The picture itself, only for its owner. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return new Response('Sign in first.', { status: 401 });
  const id = await photoId(params);
  const bytes = id ? await readPhoto(getDb(), uid, id) : null;
  if (!bytes) return new Response('Not found.', { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': imageType(bytes), 'cache-control': 'private, max-age=31536000, immutable' } });
}

/** Read the photo again (e.g. after a failed or outdated analysis). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const id = await photoId(params);
  if (!id) return Response.json({ error: 'Bad id.' }, { status: 400 });
  const day = dayParam(new URL(req.url).searchParams.get('day'));
  const a = await analyzePhoto(getDb(), uid, id, day);
  return a.ok ? Response.json({ analysis: a.read, planChange: a.planChange }) : Response.json({ error: a.message }, { status: a.status });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const id = await photoId(params);
  return id && (await deletePhoto(getDb(), uid, id)) ? Response.json({ ok: true }) : Response.json({ error: 'Not found.' }, { status: 404 });
}
