import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { TTS_SERVICES } from '@/tts/synthesize';
import { VoiceStudio } from './voice-studio';

const SERVICE_LABEL: Record<string, string> = {
  elevenlabs: 'ElevenLabs',
  googletts: 'Google Cloud TTS',
};

export default async function VoicePage() {
  const uid = await requireUserId();
  const keys = await listKeys(getDb(), uid);
  // Service keys share the providerKeys table; the first connected TTS service wins.
  const connected = TTS_SERVICES.find((s) => keys.some((k) => k.provider === s && k.status === 'valid'));
  return <VoiceStudio service={connected ?? null} serviceLabel={connected ? SERVICE_LABEL[connected] : null} />;
}
