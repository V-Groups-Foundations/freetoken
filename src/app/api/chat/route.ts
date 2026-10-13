import { sessionUserId } from '@/lib/session';
import { routeChat } from '@/router/execute';
import { validateChatBody } from '@/server/chat-body';
import { getDeps } from '@/server/deps';

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });
  const text = await req.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return Response.json({ error: { message: 'Body must be JSON.' } }, { status: 400 });
  }
  const v = validateChatBody(raw, text.length);
  if (!v.ok) return Response.json({ error: { message: v.message } }, { status: 400 });
  const out = await routeChat(
    { userId: uid, source: 'chat', body: { model: v.body.model, messages: v.body.messages, stream: true } },
    getDeps(),
  );
  if (out.ok) return out.response;
  return Response.json({ error: { message: out.message, code: out.code } }, { status: out.status });
}
