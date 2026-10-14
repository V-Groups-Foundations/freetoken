import { z } from 'zod';
import { loadCredentials } from '@/keys/service';
import { EMBEDDING_PROVIDERS, pickModality } from '@/router/modalities';
import { chunkText, embedTexts } from '@/rag/embed';
import { createDocument, insertChunks, listDocuments } from '@/rag/service';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';

const MAX_DOC_CHARS = 200_000;
const EMBED_BATCH = 50;

const bodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(MAX_DOC_CHARS),
});

export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const docs = await listDocuments(getDeps().db, uid);
  return Response.json({ documents: docs });
}

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'A name and non-empty text are required (max 200k characters).' } }, { status: 400 });

  const deps = getDeps();
  const creds = await loadCredentials(deps.db, uid, deps.vaultKey);
  const pick = pickModality(EMBEDDING_PROVIDERS, creds);
  if (!pick) {
    return Response.json(
      { error: { message: 'Document search needs an embedding provider. Connect Gemini or Jina at /connect.', code: 'no_embed_provider' } },
      { status: 400 },
    );
  }
  const c = creds.get(pick.provider)!.creds;

  const chunks = chunkText(parsed.data.text);
  if (chunks.length === 0) return Response.json({ error: { message: 'No usable text found in the document.' } }, { status: 400 });

  // Embed in batches so a large document doesn't exceed a provider's per-request limit.
  const embedded: { chunkIndex: number; content: string; embedding: number[] }[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const r = await embedTexts(pick.baseUrl, c.key, pick.model, batch.map((b) => b.text), { fetchImpl: deps.fetchImpl });
    if (!r.ok) return Response.json({ error: { message: `Embedding failed: ${r.message}` } }, { status: r.status || 502 });
    batch.forEach((b, j) => embedded.push({ chunkIndex: b.index, content: b.text, embedding: r.vectors[j] }));
  }

  const id = await createDocument(deps.db, uid, {
    name: parsed.data.name,
    chars: parsed.data.text.length,
    chunkCount: embedded.length,
    embedProvider: pick.provider,
    embedModel: pick.model,
  });
  await insertChunks(deps.db, id, embedded);

  return Response.json({ id, name: parsed.data.name, chunkCount: embedded.length }, { status: 201 });
}
