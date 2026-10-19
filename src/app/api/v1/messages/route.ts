import { getDeps } from '@/server/deps';
import { handleMessages } from '@/server/anthropic';

/** Anthropic-compatible endpoint: point Claude Code (ANTHROPIC_BASE_URL=<host>/api) or any Anthropic SDK here. */
export const POST = (req: Request) => handleMessages(req, getDeps());
