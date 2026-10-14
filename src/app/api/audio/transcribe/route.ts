import { loadCredentials } from '@/keys/service';
import { getProvider } from '@/providers/registry';
import { STT_PROVIDERS, pickModality } from '@/router/modalities';
import { callTranscription } from '@/providers/client';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB (Whisper API limit)

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob) || file.size === 0) {
    return Response.json({ error: { message: 'An audio file is required.' } }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: { message: 'Audio is too large (max 25 MB).' } }, { status: 400 });
  }

  const deps = getDeps();
  const creds = await loadCredentials(deps.db, uid, deps.vaultKey);
  const pick = pickModality(STT_PROVIDERS, creds);
  if (!pick) {
    return Response.json(
      { error: { message: 'Voice transcription needs Groq (free Whisper). Connect it at /connect.', code: 'no_stt_provider' } },
      { status: 400 },
    );
  }
  const def = getProvider(pick.provider)!;
  const c = creds.get(pick.provider)!.creds;

  const filename = file instanceof File && file.name ? file.name : 'audio.webm';
  const r = await callTranscription(def, c, { file, filename, model: pick.model }, { fetchImpl: deps.fetchImpl });
  if (!r.ok) return Response.json({ error: { message: r.error.message } }, { status: r.error.status || 502 });

  let json: unknown;
  try {
    json = await r.response.json();
  } catch {
    return Response.json({ error: { message: 'The transcription service returned an unreadable response.' } }, { status: 502 });
  }
  const text = (json as { text?: string })?.text ?? '';
  return Response.json({ text });
}
