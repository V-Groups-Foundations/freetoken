// OpenAI-compatible POST /v1/images/generations — what V-Run's generate_image tool (and any OpenAI SDK)
// calls. Free engines only: Cloudflare FLUX on the user's account, else keyless Pollinations.

import { z } from 'zod';
import { createImage } from '@/images/service';
import { dataUrlBytes, saveImage } from '@/images/gallery';
import type { Deps } from './deps';
import { userIdFromBearer } from './tokens';
import { oaiError } from './v1';

const bodySchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  n: z.number().int().min(1).max(4).optional(),
  size: z.string().regex(/^\d{2,4}x\d{2,4}$/).optional(),
  response_format: z.enum(['b64_json', 'url']).optional(),
  model: z.string().optional(), // accepted and ignored: FreeToken picks the free engine
});

export async function handleImageGenerations(req: Request, deps: Deps): Promise<Response> {
  const userId = await userIdFromBearer(deps.db, req.headers.get('authorization'));
  if (!userId) return oaiError(401, 'invalid_api_key', 'Missing or invalid FreeToken API token.');
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return oaiError(400, 'invalid_request', 'Send {"prompt": "…"} — optional n (1–4), size ("1024x1024"), response_format ("b64_json" or "url").');
  const { prompt, n = 1, size, response_format = 'b64_json' } = parsed.data;
  const [width, height] = size ? size.split('x').map(Number) : [undefined, undefined];

  const data: { b64_json?: string; url?: string; revised_prompt: string }[] = [];
  for (let i = 0; i < n; i++) {
    const r = await createImage(deps, userId, { prompt, width, height });
    if (!r.ok) {
      if (data.length) break; // return what was made
      const code = r.status === 429 ? 'rate_limited' : r.status === 422 ? 'content_filtered' : 'image_failed';
      return oaiError(r.status >= 400 ? r.status : 502, code, r.message);
    }
    const bytes = dataUrlBytes(r.dataUrl);
    if (bytes) await saveImage(deps.db, { userId, prompt, kind: 'api', engine: r.engine ?? 'unknown', bytes }).catch(() => null);
    // there's no public address to hand out for a private picture: "url" gets a data URL
    data.push(response_format === 'url' ? { url: r.dataUrl, revised_prompt: prompt } : { b64_json: r.dataUrl.split(',')[1], revised_prompt: prompt });
  }
  return Response.json({ created: Math.floor(Date.now() / 1000), data });
}
