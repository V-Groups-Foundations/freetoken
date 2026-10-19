import { getDeps } from '@/server/deps';
import { handleCountTokens } from '@/server/anthropic';

export const POST = (req: Request) => handleCountTokens(req, getDeps());
