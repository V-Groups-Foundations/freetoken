import { z } from 'zod';
import { getDb } from '@/db';
import { addChatMessage, getChat, listChatMessages, renameChat, titleFrom, touchChat } from '@/chat/service';
import { tapAssistant } from '@/server/stream';
import { routeChat } from '@/router/execute';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';

const MAX_HISTORY = 100;

const textPart = z.object({ type: z.literal('text'), text: z.string().max(4_000_000) });
const imagePart = z.object({
  type: z.literal('image_url'),
  image_url: z.object({ url: z.string().max(8_000_000) }),
});
const contentSchema = z.union([
  z.string().trim().min(1).max(4_000_000),
  z.array(z.union([textPart, imagePart])).min(1).max(12),
]);

// A text-only rendering of the message, for the saved history and the title. Images become
// a small marker so the conversation memory stays text (no base64 bloat in the database).
function toStoredText(content: z.infer<typeof contentSchema>): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const p of content) {
    if (p.type === 'text') parts.push(p.text);
    else parts.push('🖼️ [image attached]');
  }
  return parts.join('\n').trim() || '🖼️ [image attached]';
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const { id } = await params;
  const db = getDb();
  const chat = await getChat(db, uid, id);
  if (!chat) return Response.json({ error: { message: 'Chat not found.' } }, { status: 404 });

  const parsed = z.object({ content: contentSchema }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'Message is required.' } }, { status: 400 });
  const content = parsed.data.content;
  const storedText = toStoredText(content);

  // Memory: the model sees the whole saved conversation (as text) plus this turn's rich content.
  const prior = await listChatMessages(db, id);
  const history = prior.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content }));
  const out = await routeChat(
    { userId: uid, source: 'chat', body: { model: chat.model, messages: [...history, { role: 'user', content }], stream: true } },
    getDeps(),
  );
  if (!out.ok) return Response.json({ error: { message: out.message, code: out.code } }, { status: out.status });
  // saved only once a model is answering: a failed send leaves no unanswered message behind
  await addChatMessage(db, id, { role: 'user', content: storedText });
  if (prior.length === 0 && (chat.title === 'New chat' || !chat.title)) {
    await renameChat(db, uid, id, titleFrom(storedText));
  }

  const provider = out.response.headers.get('x-freetoken-provider');
  const persisted = out.response.body
    ? tapAssistant(out.response.body, (text) => {
        void addChatMessage(db, id, { role: 'assistant', content: text, provider })
          .then(() => touchChat(db, id))
          .catch((e) => console.error('persist chat assistant failed', e));
      })
    : null;
  return new Response(persisted, { status: 200, headers: out.response.headers });
}
