// Making a picture for a user with whatever they have: Cloudflare FLUX on their own account when it's
// connected (a documented API with a daily free allowance), keyless Pollinations otherwise or when
// Cloudflare can't (allowance used up, unreachable, failing). Used by /v1/images/generations.

import type { DB } from '@/db';
import type { FetchFn } from '@/providers/client';
import { loadCredentials } from '@/keys/service';
import { generateImage, type GenerateResult } from './generate';
import { generateImageCloudflare } from './cloudflare';

export async function createImage(
  deps: { db: DB; vaultKey?: Buffer; fetchImpl?: FetchFn },
  userId: string,
  input: { prompt: string; width?: number; height?: number },
): Promise<GenerateResult & { engine?: string }> {
  const cf = (await loadCredentials(deps.db, userId, deps.vaultKey)).get('cloudflare');
  if (cf) {
    const r = await generateImageCloudflare({ prompt: input.prompt, width: input.width, height: input.height }, { key: cf.creds.key, accountId: cf.creds.extra }, { fetchImpl: deps.fetchImpl });
    if (r.ok) return { ...r, engine: 'cloudflare' };
    // a refused prompt or a bad key won't go better elsewhere; a used-up day or an outage might
    if (!(r.status === 429 || r.status === 0 || r.status >= 500)) return r;
  }
  const r = await generateImage({ prompt: input.prompt, width: input.width, height: input.height }, { fetchImpl: deps.fetchImpl });
  return r.ok ? { ...r, engine: 'pollinations' } : r;
}
