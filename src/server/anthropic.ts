import { anthropicError, fromOpenAI, mapModel, streamToAnthropic, toOpenAI, type AnthropicRequest } from '@/anthropic/translate';
import { routeChat } from '@/router/execute';
import { estimateTokens } from '@/usage/ledger';
import { isMessage, validateChatBody } from './chat-body';
import type { Deps } from './deps';
import { userIdFromBearer } from './tokens';

/** Claude-style clients send the key as x-api-key (ANTHROPIC_API_KEY) or a bearer (ANTHROPIC_AUTH_TOKEN). */
async function userFrom(req: Request, deps: Deps) {
  const key = req.headers.get('x-api-key');
  return userIdFromBearer(deps.db, req.headers.get('authorization') ?? (key ? `Bearer ${key}` : null));
}

async function readBody(req: Request): Promise<{ raw: AnthropicRequest; size: number } | Response> {
  const text = await req.text();
  try {
    const raw = JSON.parse(text) as AnthropicRequest;
    if (!raw || !Array.isArray(raw.messages) || raw.messages.length === 0) return anthropicError(400, 'messages must be a non-empty array.');
    // each message an object with a role, before translating (a null crashed the translation: a 500)
    const bad = raw.messages.findIndex((m) => !isMessage(m));
    if (bad >= 0) return anthropicError(400, `messages[${bad}] must be an object with a string "role".`);
    return { raw, size: text.length };
  } catch {
    return anthropicError(400, 'Body must be JSON.');
  }
}

/** POST /v1/messages — the Anthropic Messages API, served by FreeToken's router. */
export async function handleMessages(req: Request, deps: Deps): Promise<Response> {
  const userId = await userFrom(req, deps);
  if (!userId) return anthropicError(401, 'Missing or invalid FreeToken API token — use an ft_ token as the API key.');
  const parsed = await readBody(req);
  if (parsed instanceof Response) return parsed;
  const body = toOpenAI(parsed.raw);
  if (parsed.raw.stream) body.stream_options = { include_usage: true }; // real output tokens in message_delta
  const v = validateChatBody(body, parsed.size);
  if (!v.ok) return anthropicError(400, v.message);

  const out = await routeChat({ userId, source: 'api', body: v.body }, deps);
  if (!out.ok) return anthropicError(out.status, out.message);
  const model = parsed.raw.model ?? mapModel(undefined);
  const provider = out.response.headers.get('x-freetoken-provider');
  const headers: Record<string, string> = provider ? { 'x-freetoken-provider': provider } : {};

  if (parsed.raw.stream) {
    if (!out.response.body) return anthropicError(502, 'The provider returned no stream.');
    // the first estimate counts the tool definitions too (they're big for Claude Code); the provider's
    // real count replaces it at the end of the stream
    return new Response(streamToAnthropic(out.response.body, model, estimateTokens([body.messages, body.tools])), {
      headers: { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
    });
  }
  return Response.json(fromOpenAI(await out.response.json(), model), { headers });
}

/** POST /v1/messages/count_tokens — an estimate (FreeToken doesn't know which model will answer yet). */
export async function handleCountTokens(req: Request, deps: Deps): Promise<Response> {
  if (!(await userFrom(req, deps))) return anthropicError(401, 'Missing or invalid FreeToken API token.');
  const parsed = await readBody(req);
  if (parsed instanceof Response) return parsed;
  const body = toOpenAI(parsed.raw);
  return Response.json({ input_tokens: estimateTokens(body.messages) + Math.ceil(JSON.stringify(body.tools ?? []).length / 4) });
}
