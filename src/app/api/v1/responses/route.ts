import { getDeps } from '@/server/deps';
import { handleResponses } from '@/server/responses';

/** OpenAI Responses API: point the Codex CLI (wire_api = "responses") or the OpenAI SDK's responses.create here. */
export const POST = (req: Request) => handleResponses(req, getDeps());
