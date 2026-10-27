import { getDb, type DB } from '@/db';
import { getKV, type KV } from '@/lib/kv';
import type { FetchFn } from '@/providers/client';

export interface Deps {
  db: DB;
  kv: KV;
  fetchImpl?: FetchFn;
  vaultKey?: Buffer;
  now?: () => number;
  /** how long a stream may stay silent before its first event (default 75 s) */
  firstEventMs?: number;
}

export function getDeps(): Deps {
  return { db: getDb(), kv: getKV() };
}
