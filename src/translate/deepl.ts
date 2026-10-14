// DeepL translation (BYO free key). Used by the Translator tool when a DeepL key is
// connected and the requested language maps to a DeepL target code; otherwise the tool
// falls back to LLM translation, so any language still works.

import type { FetchFn } from '@/providers/client';
import { deeplHost } from '@/services/registry';

// DeepL v2 target languages, by common English name and by code (lowercased keys).
const TARGETS: Record<string, string> = {
  bulgarian: 'BG', czech: 'CS', danish: 'DA', german: 'DE', greek: 'EL',
  english: 'EN-US', 'english (us)': 'EN-US', 'english (uk)': 'EN-GB', 'british english': 'EN-GB',
  spanish: 'ES', estonian: 'ET', finnish: 'FI', french: 'FR', hungarian: 'HU',
  indonesian: 'ID', italian: 'IT', japanese: 'JA', korean: 'KO', lithuanian: 'LT',
  latvian: 'LV', norwegian: 'NB', dutch: 'NL', polish: 'PL',
  portuguese: 'PT-PT', 'brazilian portuguese': 'PT-BR', romanian: 'RO', russian: 'RU',
  slovak: 'SK', slovenian: 'SL', swedish: 'SV', turkish: 'TR', ukrainian: 'UK',
  chinese: 'ZH', 'simplified chinese': 'ZH', mandarin: 'ZH',
};
const CODES = new Set([
  'BG', 'CS', 'DA', 'DE', 'EL', 'EN', 'EN-GB', 'EN-US', 'ES', 'ET', 'FI', 'FR', 'HU', 'ID',
  'IT', 'JA', 'KO', 'LT', 'LV', 'NB', 'NL', 'PL', 'PT', 'PT-BR', 'PT-PT', 'RO', 'RU', 'SK',
  'SL', 'SV', 'TR', 'UK', 'ZH',
]);

/** Map a free-text language ("Spanish", "ja", "PT-BR") to a DeepL target code, or null. */
export function resolveTarget(lang: string): string | null {
  const raw = lang.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (CODES.has(upper)) return upper;
  return TARGETS[raw.toLowerCase()] ?? null;
}

export async function translateDeepL(
  text: string,
  target: string,
  key: string,
  fetchImpl: FetchFn = fetch,
): Promise<string> {
  const res = await fetchImpl(`https://${deeplHost(key)}/v2/translate`, {
    method: 'POST',
    headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: [text], target_lang: target }),
  });
  if (!res.ok) throw new Error(`DeepL returned ${res.status}`);
  const json = (await res.json()) as { translations?: { text?: string }[] };
  const out = json.translations?.[0]?.text;
  if (typeof out !== 'string') throw new Error('DeepL returned no translation.');
  return out;
}
