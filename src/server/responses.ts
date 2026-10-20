import { fromChat, responsesError, streamToResponses, toChat } from '@/openai/responses';
import { routeChat } from '@/router/execute';
import { validateChatBody } from './chat-body';
import type { Deps } from './deps';
import { userIdFromBearer } from './tokens';

/** POST /v1/responses — the OpenAI Responses API (what the Codex CLI speaks), served by FreeToken's router. */
export async function handleResponses(req: Request, deps: Deps): Promise<Response> {
  const userId = await userIdFromBearer(deps.db, req.headers.get('authorization'));
  if (!userId) return responsesError(401, 'Missing or invalid FreeToken API token — use an ft_ token as the API key.');
  const text = await req.text();
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(text); } catch { return responsesError(400, 'Body must be JSON.', 'invalid_json'); }
  if (!raw || (typeof raw.input !== 'string' && !Array.isArray(raw.input))) return responsesError(400, 'input must be a string or an array of items.', 'invalid_input');

  const { body, kinds } = toChat(raw);
  const v = validateChatBody(body, text.length);
  if (!v.ok) return responsesError(400, v.message, 'invalid_request');
  const out = await routeChat({ userId, source: 'api', body: v.body }, deps);
  if (!out.ok) return responsesError(out.status, out.message, out.code);

  const model = String(raw.model ?? 'auto-smart');
  const provider = out.response.headers.get('x-freetoken-provider');
  const headers: Record<string, string> = provider ? { 'x-freetoken-provider': provider } : {};
  if (body.stream) {
    if (!out.response.body) return responsesError(502, 'The provider returned no stream.');
    return new Response(streamToResponses(out.response.body, model, kinds), {
      headers: { ...headers, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
    });
  }
  return Response.json(fromChat(await out.response.json(), model, kinds), { headers });
}
