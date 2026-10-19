// Non-chat "service" keys (web search, translation, …). These are not OpenAI-compatible
// chat providers, so they live beside the chat provider registry rather than inside it.
// Keys are stored in the SAME encrypted vault (provider_keys) under the service id, so
// loadCredentials() returns them alongside chat keys — no schema change needed.

import type { FetchFn } from '@/providers/client';

export type ServiceId = 'tavily' | 'deepl' | 'jina' | 'ocrspace' | 'elevenlabs' | 'googletts';
export type ServiceKind = 'search' | 'translate' | 'embed' | 'ocr' | 'tts';

export type ServiceCheck = { ok: true; note?: string } | { ok: false; message: string };

export interface ServiceDef {
  id: ServiceId;
  name: string;
  kind: ServiceKind;
  /** What capability connecting this unlocks, shown on the card. */
  kindLabel: string;
  keyUrl: string;
  steps: string[];
  /** Short free-tier chip, e.g. "1,000 searches / month". */
  freeTier: string;
  note?: string;
  /** Verify the pasted key with a cheap live call. */
  validate(key: string, fetchImpl?: FetchFn): Promise<ServiceCheck>;
}

/** fetch with a hard timeout; a thrown/aborted call is reported as a transient failure, not a bad key. */
async function timedFetch(url: string, init: RequestInit, fetchImpl: FetchFn, timeoutMs = 30_000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Shared mapping: only an explicit auth rejection is a bad key; slow/5xx/network saves with a note. */
async function checkWith(run: () => Promise<Response>): Promise<ServiceCheck> {
  let res: Response;
  try {
    res = await run();
  } catch {
    return { ok: true, note: 'Key saved, but the service was unreachable, so it could not be fully verified. It should still work.' };
  }
  await res.body?.cancel();
  if (res.ok) return { ok: true };
  if (res.status === 401 || res.status === 403) return { ok: false, message: 'The service rejected this key.' };
  if (res.status === 429) return { ok: true, note: 'Key works but is currently rate-limited.' };
  return { ok: true, note: `Key saved, but the service returned ${res.status}, so it could not be fully verified.` };
}

/**
 * ElevenLabs keys are scoped: a key created only for "Text to Speech" legitimately gets a 401 on
 * /v1/models, so a blanket 401-rejection would wrongly reject a working key. Instead we reject only
 * when ElevenLabs says the key value itself is invalid (or it isn't an sk_ secret key), and otherwise
 * save it with a note — the key may still work for speech, and a real problem surfaces at playback.
 */
async function validateElevenLabs(key: string, fetchImpl: FetchFn): Promise<ServiceCheck> {
  const trimmed = key.trim();
  if (!trimmed.startsWith('sk_')) {
    return {
      ok: false,
      message:
        'That looks like an API key ID, not the key itself. Paste the secret key that starts with "sk_" — it’s shown once when you create or rotate the key.',
    };
  }
  let res: Response;
  try {
    res = await timedFetch('https://api.elevenlabs.io/v1/models', { method: 'GET', headers: { 'xi-api-key': trimmed } }, fetchImpl);
  } catch {
    return { ok: true, note: 'Key saved, but ElevenLabs was unreachable, so it could not be fully verified. It should still work.' };
  }
  if (res.ok) {
    await res.body?.cancel();
    return { ok: true };
  }
  if (res.status === 429) {
    await res.body?.cancel();
    return { ok: true, note: 'Key works but is currently rate-limited.' };
  }
  // Read ElevenLabs' reason to tell a genuinely bad key from a merely under-scoped one.
  const data = (await res.json().catch(() => null)) as { detail?: { status?: string; message?: string } } | null;
  const status = data?.detail?.status ?? '';
  const message = data?.detail?.message ?? '';
  if (status === 'invalid_api_key' || /invalid api key/i.test(message)) {
    return { ok: false, message: 'ElevenLabs rejected this key. Create a new key and paste the secret value that starts with "sk_".' };
  }
  const reason = message || status || `HTTP ${res.status}`;
  return {
    ok: true,
    note: `Key saved, but it could not be fully verified (${reason}). If playback fails, recreate the key with the "Text to Speech" and "Voices" permissions enabled.`,
  };
}

export const SERVICES: ServiceDef[] = [
  {
    id: 'tavily',
    name: 'Tavily',
    kind: 'search',
    kindLabel: 'Web search',
    keyUrl: 'https://app.tavily.com/home',
    steps: [
      'Sign in at app.tavily.com (no card needed).',
      'Your API key (starts with tvly-) is shown on the dashboard.',
      'Copy it and paste it here.',
    ],
    freeTier: '1,000 searches / month',
    note: 'Built for AI agents — powers the Web page’s search.',
    validate: (key, fetchImpl = fetch) =>
      checkWith(() =>
        timedFetch(
          'https://api.tavily.com/search',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ query: 'ping', max_results: 1 }),
          },
          fetchImpl,
        ),
      ),
  },
  {
    id: 'deepl',
    name: 'DeepL',
    kind: 'translate',
    kindLabel: 'Translation',
    keyUrl: 'https://www.deepl.com/your-account/keys',
    steps: [
      'Create a free "DeepL API Free" account at deepl.com/pro-api.',
      'Open Account → API keys and copy your key (free keys end in ":fx").',
      'Paste it here.',
    ],
    freeTier: '500,000 characters / month',
    note: 'When connected, the Translator tool uses DeepL for higher-quality translation.',
    validate: (key, fetchImpl = fetch) =>
      checkWith(() =>
        timedFetch(
          `https://${deeplHost(key)}/v2/usage`,
          { method: 'GET', headers: { authorization: `DeepL-Auth-Key ${key}` } },
          fetchImpl,
        ),
      ),
  },
  {
    id: 'jina',
    name: 'Jina',
    kind: 'embed',
    kindLabel: 'Document embeddings',
    keyUrl: 'https://jina.ai/api-dashboard/',
    steps: [
      'Open jina.ai/embeddings and click the API key area (no card needed).',
      'Copy your key (starts with jina_).',
      'Paste it here.',
    ],
    freeTier: '~1,000,000 tokens free',
    note: 'When connected, Docs can embed with jina-embeddings-v3. Free tier is for non-commercial use.',
    validate: (key, fetchImpl = fetch) =>
      checkWith(() =>
        timedFetch(
          'https://api.jina.ai/v1/embeddings',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: 'jina-embeddings-v3', input: ['ping'] }),
          },
          fetchImpl,
        ),
      ),
  },
  {
    id: 'ocrspace',
    name: 'OCR.space',
    kind: 'ocr',
    kindLabel: 'Scanned-file OCR',
    keyUrl: 'https://ocr.space/ocrapi/freekey',
    steps: [
      'Open ocr.space/ocrapi/freekey and enter your email (no card needed).',
      'The free API key is emailed to you instantly.',
      'Paste it here.',
    ],
    freeTier: '25,000 requests / month',
    note: 'When connected, Docs can read scanned PDFs and images (photos of text) by OCR.',
    validate: async (key, fetchImpl = fetch) => {
      // OCR.space has no auth-only endpoint, so we OCR a 1x1 PNG and inspect the JSON for a key error.
      try {
        const form = new FormData();
        form.append('apikey', key);
        form.append('filetype', 'PNG');
        form.append('base64Image', `data:image/png;base64,${PNG_1x1}`);
        const res = await timedFetch('https://api.ocr.space/parse/image', { method: 'POST', body: form }, fetchImpl);
        if (!res.ok) return { ok: true, note: `Key saved, but OCR.space returned ${res.status}, so it could not be fully verified.` };
        const json = (await res.json().catch(() => ({}))) as { IsErroredOnProcessing?: boolean; ErrorMessage?: string | string[] };
        const err = Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join(' ') : json.ErrorMessage ?? '';
        if (json.IsErroredOnProcessing && /api\s*key|invalid|not\s*valid/i.test(err)) {
          return { ok: false, message: 'OCR.space rejected this key.' };
        }
        return { ok: true };
      } catch {
        return { ok: true, note: 'Key saved, but OCR.space was unreachable, so it could not be fully verified. It should still work.' };
      }
    },
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    kind: 'tts',
    kindLabel: 'Text-to-speech',
    keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    steps: [
      'Sign in at elevenlabs.io (no card needed).',
      'Open Settings → API Keys and create a key.',
      'Copy it and paste it here.',
    ],
    freeTier: '10,000 credits / month',
    note: 'When connected, "Listen" uses ElevenLabs’ premium voices instead of your browser’s.',
    validate: (key, fetchImpl = fetch) => validateElevenLabs(key, fetchImpl),
  },
  {
    id: 'googletts',
    name: 'Google Cloud TTS',
    kind: 'tts',
    kindLabel: 'Text-to-speech',
    keyUrl: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      'In Google Cloud, enable the "Cloud Text-to-Speech API".',
      'Create an API key under APIs & Services → Credentials.',
      'Paste it here.',
    ],
    freeTier: '4,000,000 characters / month',
    note: 'High-quality neural voices. Google Cloud may require a billing account on file even for the free tier.',
    validate: (key, fetchImpl = fetch) =>
      checkWith(() =>
        timedFetch(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(key)}`, { method: 'GET' }, fetchImpl),
      ),
  },
];

// 1x1 transparent PNG, used only to confirm an OCR.space key is accepted.
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** DeepL routes free keys (suffix ":fx") to a different host than paid keys. */
export function deeplHost(key: string): string {
  return key.trim().endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com';
}

export function getService(id: string): ServiceDef | undefined {
  return SERVICES.find((s) => s.id === id);
}

export type PublicService = Omit<ServiceDef, 'validate'>;

export function toPublicService(def: ServiceDef): PublicService {
  const { id, name, kind, kindLabel, keyUrl, steps, freeTier, note } = def;
  return { id, name, kind, kindLabel, keyUrl, steps, freeTier, ...(note ? { note } : {}) };
}
