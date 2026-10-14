import { z } from 'zod';
import { loadCredentials } from '@/keys/service';
import { sessionUserId } from '@/lib/session';
import { getDeps } from '@/server/deps';
import { synthesizeTTS, TTS_SERVICES } from '@/tts/synthesize';

const bodySchema = z.object({ text: z.string().trim().min(1).max(5000) });

export async function POST(req: Request) {
  const uid = await sessionUserId();
  if (!uid) return Response.json({ error: { message: 'Sign in first.' } }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { message: 'Text to read is required.' } }, { status: 400 });

  const deps = getDeps();
  const creds = await loadCredentials(deps.db, uid, deps.vaultKey);
  const serviceId = TTS_SERVICES.find((s) => creds.has(s));
  if (!serviceId) {
    // No premium TTS connected — the client falls back to the browser's own voice.
    return Response.json({ error: { message: 'No text-to-speech service connected.', code: 'no_tts' } }, { status: 400 });
  }

  const result = await synthesizeTTS(serviceId, creds.get(serviceId)!.creds.key, parsed.data.text, deps.fetchImpl);
  if (!result.ok) return Response.json({ error: { message: result.message } }, { status: result.status || 502 });
  return Response.json({ dataUrl: result.dataUrl, service: serviceId });
}
