import { getDeps } from '@/server/deps';
import { handleModels } from '@/server/v1';

export const GET = (req: Request) => handleModels(req, getDeps());
