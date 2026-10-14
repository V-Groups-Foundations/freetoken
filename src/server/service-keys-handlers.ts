import { z } from 'zod';
import { saveKey } from '@/keys/service';
import { getService } from '@/services/registry';
import type { Deps } from './deps';

const saveSchema = z.object({
  service: z.string(),
  key: z.string().trim().min(8).max(500),
});

export async function handleSaveServiceKey(userId: string, raw: unknown, deps: Deps) {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: 'Please paste a valid key.' } };
  const def = getService(parsed.data.service);
  if (!def) return { status: 400, body: { error: 'Unknown service.' } };

  const check = await def.validate(parsed.data.key, deps.fetchImpl);
  if (!check.ok) return { status: 400, body: { error: check.message } };

  await saveKey(deps.db, userId, def.id, parsed.data.key, null, deps.vaultKey);
  return { status: 200, body: { ok: true, note: check.note ?? null } };
}
