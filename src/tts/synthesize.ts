// Server-side text-to-speech via a connected service (ElevenLabs or Google Cloud TTS).
// Returns an mp3 data URL the browser can play. When no TTS service is connected, callers
// fall back to the browser's built-in speechSynthesis.

import type { FetchFn } from '@/providers/client';

export type TtsResult =
  | { ok: true; dataUrl: string }
  | { ok: false; status: number; message: string };

/** TTS services in preference order (first connected one wins). */
export const TTS_SERVICES = ['elevenlabs', 'googletts'] as const;

const ELEVEN_VOICE = '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — a stable default free voice

async function timed<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function synthesizeTTS(
  serviceId: string,
  key: string,
  text: string,
  fetchImpl: FetchFn = fetch,
): Promise<TtsResult> {
  const clean = text.trim().slice(0, 5000);
  if (!clean) return { ok: false, status: 400, message: 'Nothing to read.' };

  try {
    if (serviceId === 'elevenlabs') {
      const res = await timed(30_000, (signal) =>
        fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify({ text: clean, model_id: 'eleven_multilingual_v2' }),
          signal,
        }),
      );
      if (!res.ok) return { ok: false, status: res.status, message: `ElevenLabs returned ${res.status}.` };
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: true, dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}` };
    }

    if (serviceId === 'googletts') {
      const res = await timed(30_000, (signal) =>
        fetchImpl(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            input: { text: clean },
            voice: { languageCode: 'en-US', name: 'en-US-Neural2-C' },
            audioConfig: { audioEncoding: 'MP3' },
          }),
          signal,
        }),
      );
      if (!res.ok) return { ok: false, status: res.status, message: `Google TTS returned ${res.status}.` };
      const json = (await res.json()) as { audioContent?: string };
      if (!json.audioContent) return { ok: false, status: 502, message: 'Google TTS returned no audio.' };
      return { ok: true, dataUrl: `data:audio/mpeg;base64,${json.audioContent}` };
    }

    return { ok: false, status: 400, message: 'Unknown TTS service.' };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the speech service.' };
  }
}
