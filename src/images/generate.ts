// Text-to-image via Pollinations — a free, keyless image service (FLUX under the hood).
// No API key or account is required, so image generation works for any signed-in user.

import type { FetchFn } from '@/providers/client';

const POLLINATIONS = 'https://image.pollinations.ai/prompt';

export type GenerateResult =
  | { ok: true; dataUrl: string }
  | { ok: false; status: number; message: string };

export interface GenerateInput {
  prompt: string;
  width?: number;
  height?: number;
  /** Fixed seed reproduces an image; omit for a fresh one each time. */
  seed?: number;
}

export function buildUrl(input: GenerateInput): string {
  const w = input.width ?? 1024;
  const h = input.height ?? 1024;
  const seed = input.seed ?? Math.floor(Math.random() * 1_000_000_000);
  const params = new URLSearchParams({ width: String(w), height: String(h), seed: String(seed), nologo: 'true', model: 'flux' });
  return `${POLLINATIONS}/${encodeURIComponent(input.prompt.trim())}?${params.toString()}`;
}

export async function generateImage(
  input: GenerateInput,
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<GenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, status: 400, message: 'Enter a prompt describing the image.' };

  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetchImpl(buildUrl(input), { signal: ctrl.signal });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `Image generation failed (HTTP ${res.status}). Try again or reword the prompt.` };
    }
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) {
      return { ok: false, status: 502, message: 'The image service returned an unexpected response.' };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, dataUrl: `data:${type};base64,${buf.toString('base64')}` };
  } catch (e) {
    const message = e instanceof Error && e.name === 'AbortError' ? 'Image generation timed out.' : 'Could not reach the image service.';
    return { ok: false, status: 0, message };
  } finally {
    clearTimeout(timer);
  }
}
