import { getDeps } from '@/server/deps';
import { handleCompletions } from '@/server/v1';

export const POST = (req: Request) => handleCompletions(req, getDeps());
