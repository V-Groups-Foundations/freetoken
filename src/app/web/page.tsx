import { getDb } from '@/db';
import { listKeys } from '@/keys/service';
import { requireUserId } from '@/lib/session';
import { WebClient } from './web-client';

export default async function WebPage() {
  const uid = await requireUserId();
  const keys = await listKeys(getDb(), uid);
  const searchEnabled = keys.some((k) => k.provider === 'tavily' && k.status === 'valid');
  return <WebClient searchEnabled={searchEnabled} />;
}
