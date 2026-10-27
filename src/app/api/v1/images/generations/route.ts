import { getDeps } from '@/server/deps';
import { handleImageGenerations } from '@/server/v1-images';

export const POST = (req: Request) => handleImageGenerations(req, getDeps());
