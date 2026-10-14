import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { ImageStudio } from './images';

export default async function ImagesPage() {
  // Default engine is keyless (Pollinations); the Gemini engine appears when Gemini is connected.
  const uid = await requireUserId();
  const keys = await listKeys(getDb(), uid);
  const geminiConnected = keys.some((k) => k.provider === 'gemini' && k.status === 'valid');
  return <ImageStudio geminiConnected={geminiConnected} />;
}
