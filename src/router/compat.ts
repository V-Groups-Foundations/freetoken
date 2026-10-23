// Providers that accept only part of the OpenAI message format get the messages rewritten into the part
// they accept, so the same conversation works on every model auto routing picks.

type Part = { type?: string; text?: string };
type Msg = { role?: string; content?: unknown } & Record<string, unknown>;

/**
 * Cloudflare Workers AI: content must be a string — not a list of text parts (V-Run, Claude Code via
 * translation), and not null on an assistant message that only calls tools. It refused the whole request
 * otherwise ("Type mismatch of '/messages/0/content', 'array' not in 'string'"), on every step after the first.
 */
function stringContent(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return (messages as Msg[]).map((m) => {
    if (Array.isArray(m?.content)) {
      const parts = m.content as Part[];
      if (parts.some((p) => p?.type && p.type !== 'text')) return m; // images: left for a model that can see
      return { ...m, content: parts.map((p) => p?.text ?? '').join('\n') };
    }
    if (m?.content == null) return { ...m, content: '' };
    return m;
  });
}

/**
 * Gemini refuses a whole request over one setting it doesn't know ("Unknown name \"repetition_penalty\":
 * Cannot find field") — settings other providers take, sent by some clients. It gets the standard ones.
 */
const GEMINI_FIELDS = new Set(['model', 'messages', 'tools', 'tool_choice', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens',
  'temperature', 'top_p', 'n', 'stop', 'response_format', 'seed', 'presence_penalty', 'frequency_penalty', 'reasoning_effort', 'extra_body']);
const only = (body: Record<string, unknown>, keep: Set<string>) => Object.fromEntries(Object.entries(body).filter(([k]) => keep.has(k)));

/** The request body as this provider accepts it. */
export function forProvider(provider: string, body: Record<string, unknown>): Record<string, unknown> {
  if (provider === 'cloudflare') return { ...body, messages: stringContent(body.messages) };
  if (provider === 'gemini') return only(body, GEMINI_FIELDS);
  return body;
}
