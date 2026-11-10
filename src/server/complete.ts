// A non-streaming chat completion through the normal router (provider selection,
// fallback, usage recording). Shared by the tools, studio, and document-Q&A features.

import { routeChat } from '@/router/execute';
import { getDeps } from '@/server/deps';
import type { Task } from '@/router/quality';

export type CompleteResult =
  | { ok: true; text: string; provider: string | null }
  | { ok: false; status: number; message: string };

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | Part[]; // parts: words and pictures, for a model that can see (task 'vision')
}

export async function completeText(
  userId: string,
  messages: Message[],
  opts: { model?: string; responseFormatJson?: boolean; temperature?: number; task?: Task; session?: string } = {},
): Promise<CompleteResult> {
  const body: Record<string, unknown> = {
    model: opts.model ?? 'auto-smart',
    messages,
    stream: false,
  };
  if (opts.responseFormatJson) body.response_format = { type: 'json_object' };
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature;

  let out = await routeChat({ userId, source: 'chat', body, task: opts.task, session: opts.session }, getDeps());
  // "the model on this session is busy, retry after N s": wait those seconds once rather than fail the task
  if (!out.ok && out.status === 429 && out.retryAfterMs != null && out.retryAfterMs <= 20_000) {
    await new Promise((ok) => setTimeout(ok, out.ok ? 0 : (out.retryAfterMs ?? 0) + 250));
    out = await routeChat({ userId, source: 'chat', body, task: opts.task, session: opts.session }, getDeps());
  }
  if (!out.ok) return { ok: false, status: out.status, message: out.message };

  const provider = out.response.headers.get('x-freetoken-provider');
  let json: unknown;
  try {
    json = await out.response.json();
  } catch {
    return { ok: false, status: 502, message: 'The model returned an unreadable response.' };
  }
  const text = (json as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') return { ok: false, status: 502, message: 'The model returned no text.' };
  return { ok: true, text, provider };
}
