import { loadCredentials } from '@/keys/service';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { listVoices, TTS_SERVICES } from '@/tts/synthesize';

/** List the selectable voices for the user's connected TTS service (first connected one wins). */
export async function GET() {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const deps = getDeps();
  const creds = await loadCredentials(deps.db, uid, deps.vaultKey);
  const serviceId = TTS_SERVICES.find((s) => creds.has(s));
  if (!serviceId) {
    return Response.json({ error: { message: 'No text-to-speech service connected.', code: 'no_tts' } }, { status: 400 });
  }

  const result = await listVoices(serviceId, creds.get(serviceId)!.creds.key, deps.fetchImpl);
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
  return Response.json({ service: serviceId, voices: result.voices });
}
