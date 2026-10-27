// Text-to-image and image editing via Cloudflare Workers AI. Free within the account's 10,000 Neurons a day
// (reset 00:00 UTC), shared with any chat that goes through the same Cloudflare key:
// - new images: FLUX.1 schnell — a 1024×1024 image at 4 steps costs about 58 Neurons (~170 a day)
// - edits: FLUX.2 klein 4B, which takes up to 4 reference images (an uploaded photo, a second face for a
//   swap…) — the input images are billed too, so an edit costs about twice a new image
// Unlike keyless Pollinations, this is a documented API on the user's own account.

import type { FetchFn } from '@/providers/client';
import type { GenerateInput, GenerateResult } from './generate';
import { describeNetworkFailure, unreachableHint } from '@/providers/network';

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const EDIT_MODEL = '@cf/black-forest-labs/flux-2-klein-4b';
export const MAX_EDIT_IMAGES = 4;
// the Images page shrinks pictures to 1024px before sending, so ~1.5 MB each is plenty; this is the hard stop
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type CloudflareCreds = { key: string; accountId: string | null };

export interface EditInput {
  prompt: string;
  /** Reference images in order — the instruction can name them ("the first image", "the second image"). */
  images: { bytes: Uint8Array; type: string }[];
  width?: number;
  height?: number;
}

/** Output size: keep the photo's shape, longest side at most 1024, both sides multiples of 16. */
export function editSize(width?: number, height?: number): { width: number; height: number } {
  if (!width || !height || width <= 0 || height <= 0) return { width: 1024, height: 1024 };
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const fit = (n: number) => Math.max(256, Math.round((n * scale) / 16) * 16);
  return { width: fit(width), height: fit(height) };
}

export async function generateImageCloudflare(
  input: GenerateInput,
  creds: CloudflareCreds,
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<GenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, status: 400, message: 'Enter a prompt describing the image.' };
  // FLUX.1 schnell only makes 1024×1024; another shape (a banner, a phone screen) goes to FLUX.2 klein
  if (input.width && input.height && (input.width !== 1024 || input.height !== 1024)) {
    const size = editSize(input.width, input.height);
    const form = new FormData();
    form.append('prompt', prompt.slice(0, 2048));
    form.append('width', String(size.width));
    form.append('height', String(size.height));
    return run(creds, EDIT_MODEL, { body: form }, opts);
  }
  return run(creds, MODEL, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 4, ...(input.seed != null ? { seed: input.seed } : {}) }),
  }, opts);
}

export async function editImageCloudflare(
  input: EditInput,
  creds: CloudflareCreds,
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<GenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, status: 400, message: 'Say how to change the picture.' };
  if (input.images.length === 0) return { ok: false, status: 400, message: 'Add a picture to edit.' };
  if (input.images.length > MAX_EDIT_IMAGES) return { ok: false, status: 400, message: `Up to ${MAX_EDIT_IMAGES} pictures at a time.` };
  const size = editSize(input.width, input.height);
  const form = new FormData();
  form.append('prompt', prompt.slice(0, 2048));
  form.append('width', String(size.width));
  form.append('height', String(size.height));
  input.images.forEach((img, i) => form.append(`input_image_${i}`, new Blob([img.bytes as BlobPart], { type: img.type }), `image${i}`));
  return run(creds, EDIT_MODEL, { body: form }, opts);
}

/** `data:image/png;base64,…` → bytes, or null when it isn't a base64 image data URL. */
export function parseImageDataUrl(url: string): { bytes: Uint8Array; type: string } | null {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(url);
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  return bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES ? { bytes, type: m[1].toLowerCase() } : null;
}

async function run(
  creds: CloudflareCreds,
  model: string,
  init: { headers?: Record<string, string>; body: BodyInit },
  opts: { fetchImpl?: FetchFn; timeoutMs?: number },
): Promise<GenerateResult> {
  if (!creds.accountId) return { ok: false, status: 400, message: 'Your Cloudflare key has no Account ID saved — reconnect it at /connect.' };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/ai/run/${model}`, {
      method: 'POST',
      headers: { ...init.headers, authorization: `Bearer ${creds.key}` },
      body: init.body,
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
      // Cloudflare's own safety check on the result ("Your output has been flagged…") — no setting turns it off
      if (/flagged/i.test(text)) {
        return { ok: false, status: 422, message: "Cloudflare's safety filter blocked this result. Realistic face swaps and photos of real people are the usual reason — try a different picture, or a stylized edit (anime, 3D cartoon, sketch)." };
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
