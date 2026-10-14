// A non-streaming chat completion through the normal router (provider selection,
// fallback, usage recording). Shared by the tools, studio, and document-Q&A features.

import { routeChat } from '@/router/execute';
import { getDeps } from '@/server/deps';

export type CompleteResult =
  | { ok: true; text: string; provider: string | null }
  | { ok: false; status: number; message: string };

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function completeText(
  userId: string,
  messages: Message[],
  opts: { model?: string; responseFormatJson?: boolean; temperature?: number } = {},
): Promise<CompleteResult> {
  const body: Record<string, unknown> = {
    model: opts.model ?? 'auto-smart',
    messages,
    stream: false,
  };
  if (opts.responseFormatJson) body.response_format = { type: 'json_object' };
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature;

  const out = await routeChat({ userId, source: 'chat', body }, getDeps());
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
