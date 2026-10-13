import { z } from 'zod';
import { saveKey, validateKey } from '@/keys/service';
import { getProvider } from '@/providers/registry';
import type { Deps } from './deps';

const saveSchema = z.object({
  provider: z.string(),
  key: z.string().trim().min(8).max(500),
  extra: z.string().trim().max(200).optional(),
});

export async function handleSaveKey(userId: string, raw: unknown, deps: Deps) {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: 'Please paste a valid key.' } };
  const def = getProvider(parsed.data.provider);
  if (!def) return { status: 400, body: { error: 'Unknown provider.' } };
  const extra = parsed.data.extra || null;
  if (def.extraField && !extra) return { status: 400, body: { error: `${def.extraField.label} is required.` } };

  const check = await validateKey(def, { key: parsed.data.key, extra }, deps.fetchImpl);
  if (!check.ok) return { status: 400, body: { error: check.message } };

  await saveKey(deps.db, userId, def.id, parsed.data.key, extra, deps.vaultKey);
  return { status: 200, body: { ok: true, note: check.note ?? null } };
}
