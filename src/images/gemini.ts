// Text-to-image via Gemini (BYO free key) — uses the native generateContent image modality.
// An alternative to the keyless Pollinations engine for users who've connected Gemini.

import type { FetchFn } from '@/providers/client';
import type { GenerateInput, GenerateResult } from './generate';
import { describeNetworkFailure, looksLikeWebPage, unreachableHint } from '@/providers/network';

const MODEL = 'gemini-2.5-flash-image';

export async function generateImageGemini(
  input: GenerateInput,
  key: string,
  opts: { fetchImpl?: FetchFn; timeoutMs?: number } = {},
): Promise<GenerateResult> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, status: 400, message: 'Enter a prompt describing the image.' };

  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
        signal: ctrl.signal,
      },
    );
    if (!res.ok) {
      let msg: string;
      const body = await res.clone().text().catch(() => '');
      if (res.status < 500 && looksLikeWebPage(res.headers.get('content-type'), body)) {
        // a firewall / proxy / Wi-Fi login page, not Google: the key is fine, the network isn't
        return { ok: false, status: res.status, message: `${unreachableHint(['gemini'])} (The network answered with its own page, HTTP ${res.status}.) Or switch to the FLUX engine.` };
      }
      if (res.status === 401 || res.status === 403) {
        msg = 'Gemini rejected your key.';
      } else if (res.status === 429) {
        msg = "Gemini's free image tier is rate-limited right now. Wait a minute and retry, or switch to the FLUX engine (free, no limit).";
      } else {
        msg = `Gemini image generation failed (HTTP ${res.status}). Try again or switch to the FLUX engine.`;
      }
      return { ok: false, status: res.status, message: msg };
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData?.data)?.inlineData;
    if (!img?.data) {
      return { ok: false, status: 502, message: 'Gemini returned no image (the prompt may have been blocked).' };
    }
    return { ok: true, dataUrl: `data:${img.mimeType ?? 'image/png'};base64,${img.data}` };
  } catch (e) {
    const message = e instanceof Error && e.name === 'AbortError'
      ? 'Gemini image generation timed out.'
      : `Could not reach Gemini: ${describeNetworkFailure(e)}. ${unreachableHint(['gemini'])} Or switch to the FLUX engine.`;
    return { ok: false, status: 0, message };
  } finally {
    clearTimeout(timer);
  }
}
