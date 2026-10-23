import { parseTask } from '@/router/quality';
import { listUserModels } from '@/router/models';
import { routeChat } from '@/router/execute';
import { validateChatBody } from './chat-body';
import type { Deps } from './deps';
import { userIdFromBearer } from './tokens';

export function oaiError(status: number, code: string, message: string) {
  const type = status === 401 ? 'authentication_error' : status === 429 ? 'rate_limit_error' : 'invalid_request_error';
  return Response.json({ error: { message, type, code } }, { status });
}

const unauthorized = () => oaiError(401, 'invalid_api_key', 'Missing or invalid FreeToken API token.');

export async function handleCompletions(req: Request, deps: Deps): Promise<Response> {
  const userId = await userIdFromBearer(deps.db, req.headers.get('authorization'));
  if (!userId) return unauthorized();
  const text = await req.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return oaiError(400, 'invalid_json', 'Body must be JSON.');
  }
  const v = validateChatBody(raw, text.length);
  if (!v.ok) return oaiError(400, 'invalid_request', v.message);
  // a client may say what kind of task this is (V-Run asks for a reasoning model to plan and debug)
  const out = await routeChat({ userId, source: 'api', body: v.body, task: parseTask(req.headers.get('x-freetoken-task')),
    session: req.headers.get('x-freetoken-session')?.slice(0, 200) || undefined }, deps);
  return out.ok ? out.response : oaiError(out.status, out.code, out.message);
}

export async function handleModels(req: Request, deps: Deps): Promise<Response> {
  const userId = await userIdFromBearer(deps.db, req.headers.get('authorization'));
  if (!userId) return unauthorized();
  const ids = ['auto-smart', 'auto-fast', ...(await listUserModels(deps.db, userId)).map((m) => m.id)];
  return Response.json({ object: 'list', data: ids.map((id) => ({ id, object: 'model', owned_by: 'freetoken' })) });
}
