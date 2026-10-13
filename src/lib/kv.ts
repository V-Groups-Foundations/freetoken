export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
}

// Per-process store. Plan 2 swaps in Upstash Redis for multi-instance deploys.
export function createMemoryKV(now: () => number = Date.now): KV {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (e.expiresAt <= now()) {
        store.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, ttlMs) {
      store.set(key, { value, expiresAt: now() + ttlMs });
    },
  };
}

const g = globalThis as unknown as { __ftKv?: KV };

export function getKV(): KV {
  return (g.__ftKv ??= createMemoryKV());
}
