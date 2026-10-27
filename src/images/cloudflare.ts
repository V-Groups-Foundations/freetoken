// Text-to-image via Cloudflare Workers AI (FLUX.1 schnell). Free within the account's 10,000 Neurons a day
// (reset 00:00 UTC): a 1024×1024 image at 4 steps costs about 58 Neurons, so roughly 170 images a day —
// shared with any chat that goes through the same Cloudflare key. Unlike keyless Pollinations, this is a
// documented API on the user's own account.

import type { FetchFn } from '@/providers/client';
import type { GenerateInput, GenerateResult } from './generate';
import { describeNetworkFailure, unreachableHint } from '@/providers/network';

const MODEL = '@cf/black-forest-labs/flux-1-schnell';

export async function generateImageCloudflare(
  input: GenerateInput,
  creds: { key: string; accountId: string | null },
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<GenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, status: 400, message: 'Enter a prompt describing the image.' };
  if (!creds.accountId) return { ok: false, status: 400, message: 'Your Cloudflare key has no Account ID saved — reconnect it at /connect.' };

  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/${MODEL}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.key}` },
      body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 4, ...(input.seed != null ? { seed: input.seed } : {}) }),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; result?: { image?: string }; errors?: { code?: number; message?: string }[] }
      | null;
    if (!res.ok || !json?.result?.image) {
      const err = json?.errors?.[0];
      const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
      if (res.status === 401 || res.status === 403 || err?.code === 10000) {
        return { ok: false, status: res.status || 401, message: 'Cloudflare rejected your key — check it has Workers AI permission at /connect.' };
      }
      // 4006: "you have used up your daily free allocation of 10,000 neurons"
      if (res.status === 429 || /4006|neurons|allocation/i.test(text)) {
        return { ok: false, status: 429, message: "Today's free Cloudflare allowance (10,000 Neurons) is used up — it resets at 00:00 UTC. Switch to the Pollinations engine meanwhile." };
      }
      if (res.ok) return { ok: false, status: 502, message: 'Cloudflare returned no image (the prompt may have been blocked).' };
      return { ok: false, status: res.status, message: `Cloudflare image generation failed (HTTP ${res.status}${err?.message ? `: ${err.message.slice(0, 160)}` : ''}).` };
    }
    return { ok: true, dataUrl: `data:image/jpeg;base64,${json.result.image}` };
  } catch (e) {
    const message = e instanceof Error && e.name === 'AbortError'
      ? 'Cloudflare image generation timed out.'
      : `Could not reach Cloudflare: ${describeNetworkFailure(e)}. ${unreachableHint(['cloudflare'])}`;
    return { ok: false, status: 0, message };
  } finally {
    clearTimeout(timer);
  }
}
