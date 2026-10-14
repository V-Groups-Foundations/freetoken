import { z } from 'zod';
import { loadCredentials } from '@/keys/service';
import { EMBEDDING_PROVIDERS, pickModality } from '@/router/modalities';
import { embedTexts } from '@/rag/embed';
import { loadUserChunks } from '@/rag/service';
import { topK } from '@/rag/search';
import { completeText } from '@/server/complete';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';

const bodySchema = z.object({ question: z.string().trim().min(1).max(4000) });
const TOP_K = 6;

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'A question is required.' } }, { status: 400 });
  const question = parsed.data.question;

  const deps = getDeps();
  const creds = await loadCredentials(deps.db, uid, deps.vaultKey);
  const pick = pickModality(EMBEDDING_PROVIDERS, creds);
  if (!pick) return Response.json({ error: { message: 'Connect Gemini or Jina at /connect to search documents.', code: 'no_embed_provider' } }, { status: 400 });

  const chunks = await loadUserChunks(deps.db, uid);
  if (chunks.length === 0) return Response.json({ error: { message: 'Upload a document first.' } }, { status: 400 });

  const c = creds.get(pick.provider)!.creds;
  const q = await embedTexts(pick.baseUrl, c.key, pick.model, [question], { fetchImpl: deps.fetchImpl });
  if (!q.ok) return Response.json({ error: { message: `Could not embed the question: ${q.message}` } }, { status: q.status || 502 });

  const hits = topK(q.vectors[0], chunks, TOP_K).filter((h) => h.score > 0.1);
  if (hits.length === 0) return Response.json({ answer: "I couldn't find anything relevant in your documents.", sources: [] });

  const context = hits
    .map((h, i) => `[${i + 1}] (from "${h.item.documentName}")\n${h.item.content}`)
    .join('\n\n');
  const messages = [
    {
      role: 'system' as const,
      content:
        'Answer the question using only the provided context from the user\'s documents. ' +
        'Cite sources inline like [1], [2]. If the context does not contain the answer, say so plainly.',
    },
    { role: 'user' as const, content: `Context:\n${context}\n\nQuestion: ${question}` },
  ];

  const result = await completeText(uid, messages, { temperature: 0.2 });
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status });

  const sources = hits.map((h, i) => ({
    n: i + 1,
    documentName: h.item.documentName,
    excerpt: h.item.content.slice(0, 240),
    score: Number(h.score.toFixed(3)),
  }));
  return Response.json({ answer: result.text, provider: result.provider, sources });
}
