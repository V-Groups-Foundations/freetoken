import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { ImageStudio } from './images';

export default async function ImagesPage() {
  // Default engine is keyless (Pollinations); the Cloudflare and Gemini engines appear when
  // those keys are connected (Cloudflare then becomes the default: a documented API with a daily free allowance).
  const uid = await requireUserId();
  const keys = await listKeys(getDb(), uid);
  const geminiConnected = keys.some((k) => k.provider === 'gemini' && k.status === 'valid');
  const cloudflareConnected = keys.some((k) => k.provider === 'cloudflare' && k.status === 'valid');
  return <ImageStudio geminiConnected={geminiConnected} cloudflareConnected={cloudflareConnected} />;
}
