// Server-side text-to-speech via a connected service (ElevenLabs or Google Cloud TTS).
// Returns an mp3 data URL the browser can play. When no TTS service is connected, callers
// fall back to the browser's built-in speechSynthesis.

import type { FetchFn } from '@/providers/client';

export type TtsResult =
  | { ok: true; dataUrl: string }
  | { ok: false; status: number; message: string };

/** A selectable voice from the connected TTS service's library. */
export interface Voice {
  id: string;
  name: string;
  description?: string;
}

export type VoicesResult =
  | { ok: true; voices: Voice[] }
  | { ok: false; status: number; message: string };

/** TTS services in preference order (first connected one wins). */
export const TTS_SERVICES = ['elevenlabs', 'googletts'] as const;

const ELEVEN_VOICE = '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — a stable default free voice
const GOOGLE_VOICE = 'en-US-Neural2-C'; // a stable default Google voice

async function timed<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the human-readable reason out of an ElevenLabs error response. Their errors look like
 * `{ detail: { status, message } }`, `{ detail: "..." }`, or a validation array. We surface that
 * reason (plus a scope hint for permission errors) instead of a bare status so failures are
 * actionable — e.g. a key created without the "Text to Speech" / "Voices" permissions.
 */
async function elevenError(res: Response): Promise<string> {
  let detailMsg = '';
  let statusTag = '';
  try {
    const data = (await res.json()) as { detail?: unknown };
    const d = data?.detail;
    if (typeof d === 'string') detailMsg = d;
    else if (d && typeof d === 'object') {
      const o = d as { message?: string; status?: string };
      if (o.message) detailMsg = o.message;
      if (o.status) statusTag = o.status;
    } else if (Array.isArray(d) && d[0] && typeof d[0] === 'object') {
      detailMsg = String((d[0] as { msg?: string }).msg ?? '');
    }
  } catch {
    /* non-JSON body */
  }
  const permissionIssue = res.status === 401 || /permission|missing_permissions/i.test(`${statusTag} ${detailMsg}`);
  const hint = permissionIssue
    ? ' Your ElevenLabs key may be missing the "Text to Speech" and "Voices" permissions — recreate the key with those scopes enabled.'
    : '';
  return `ElevenLabs returned ${res.status}${detailMsg ? `: ${detailMsg}` : ''}.${hint}`;
}

export async function synthesizeTTS(
  serviceId: string,
  key: string,
  text: string,
  fetchImpl: FetchFn = fetch,
  voiceId?: string,
): Promise<TtsResult> {
  const clean = text.trim().slice(0, 5000);
  if (!clean) return { ok: false, status: 400, message: 'Nothing to read.' };

  try {
    if (serviceId === 'elevenlabs') {
      const voice = voiceId?.trim() || ELEVEN_VOICE;
      const res = await timed(30_000, (signal) =>
        fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
          method: 'POST',
          headers: { 'xi-api-key': key, 'content-type': 'application/json' },
          body: JSON.stringify({ text: clean, model_id: 'eleven_multilingual_v2' }),
          signal,
        }),
      );
      if (!res.ok) return { ok: false, status: res.status, message: await elevenError(res) };
      const buf = Buffer.from(await res.arrayBuffer());
      return { ok: true, dataUrl: `data:audio/mpeg;base64,${buf.toString('base64')}` };
    }

    if (serviceId === 'googletts') {
      const voice = voiceId?.trim() || GOOGLE_VOICE;
      // Google voice names begin with their BCP-47 language (e.g. "en-US-Neural2-C").
      const languageCode = voice.split('-').slice(0, 2).join('-') || 'en-US';
      const res = await timed(30_000, (signal) =>
        fetchImpl(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            input: { text: clean },
            voice: { languageCode, name: voice },
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

/** Build a short human label from ElevenLabs' voice `labels` map (accent, gender, age, use case). */
function elevenDescription(labels: Record<string, string> | undefined): string | undefined {
  if (!labels) return undefined;
  const parts = [labels.accent, labels.gender, labels.age, labels.description, labels.use_case]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.replace(/_/g, ' '));
  return parts.length ? Array.from(new Set(parts)).join(' · ') : undefined;
}

/**
 * List the selectable voices for a connected TTS service.
 * ElevenLabs returns its full voice library; Google TTS is filtered to the higher-quality
 * English voices so the picker stays short and useful.
 */
export async function listVoices(
  serviceId: string,
  key: string,
  fetchImpl: FetchFn = fetch,
): Promise<VoicesResult> {
  try {
    if (serviceId === 'elevenlabs') {
      const fetchVoices = (useKey: boolean) =>
        timed(30_000, (signal) =>
          fetchImpl('https://api.elevenlabs.io/v1/voices', { headers: useKey ? { 'xi-api-key': key } : {}, signal }),
        );
      const mapVoices = async (res: Response): Promise<Voice[]> => {
        const json = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; labels?: Record<string, string> }> };
        return (json.voices ?? [])
          .filter((v) => v.voice_id && v.name)
          .map((v) => ({ id: v.voice_id, name: v.name, description: elevenDescription(v.labels) }));
      };

      const res = await fetchVoices(true);
      let voices = res.ok ? await mapVoices(res) : [];
      // A scoped key may lack the "Voices" permission, or the account may own no voices; either way
      // fall back to ElevenLabs' public premade catalog so the picker always has usable voices.
      if (!voices.length) {
        const pub = await fetchVoices(false);
        if (pub.ok) voices = await mapVoices(pub);
        else if (!res.ok) return { ok: false, status: res.status, message: await elevenError(res) };
      }
      return { ok: true, voices };
    }

    if (serviceId === 'googletts') {
      const res = await timed(30_000, (signal) =>
        fetchImpl(`https://texttospeech.googleapis.com/v1/voices?languageCode=en-US&key=${encodeURIComponent(key)}`, { signal }),
      );
      if (!res.ok) return { ok: false, status: res.status, message: `Google TTS returned ${res.status}.` };
      const json = (await res.json()) as { voices?: Array<{ name: string; ssmlGender?: string }> };
      const voices: Voice[] = (json.voices ?? [])
        .filter((v) => /Neural2|Wavenet|Studio/.test(v.name)) // skip the low-quality "Standard" voices
        .map((v) => ({
          id: v.name,
          name: v.name.replace('en-US-', ''),
          description: v.ssmlGender ? v.ssmlGender.toLowerCase() : undefined,
        }));
      return { ok: true, voices };
    }

    return { ok: false, status: 400, message: 'Unknown TTS service.' };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the speech service.' };
  }
}
