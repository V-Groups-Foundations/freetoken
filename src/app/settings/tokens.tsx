'use client';

import { useEffect, useState } from 'react';

type Token = { id: number; name: string; prefix: string; lastUsedAt: string | null };

async function fetchTokens(): Promise<Token[]> {
  return (await fetch('/api/tokens')).json();
}

export function Tokens() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);

  const reload = async () => setTokens(await fetchTokens());
  useEffect(() => {
    let active = true;
    fetchTokens().then((t) => { if (active) setTokens(t); });
    return () => { active = false; };
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!res.ok) return;
    setFresh((await res.json()).token);
    setName('');
    void reload();
  }

  async function revoke(id: number) {
    await fetch(`/api/tokens?id=${id}`, { method: 'DELETE' });
    void reload();
  }

  return (
    <div className="space-y-4 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">API tokens</h2>
      {fresh && (
        <div className="rounded bg-green-50 p-3 text-sm">
          Copy this token now; it won’t be shown again:
          <code className="mt-1 block break-all rounded bg-white p-2">{fresh}</code>
        </div>
      )}
      <form onSubmit={create} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. laptop" className="flex-1 rounded border px-3 py-2 text-sm" />
        <button disabled={!name.trim()} className="rounded bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-40">Create</button>
      </form>
      <ul className="divide-y text-sm">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span>{t.name} <code className="text-neutral-500">{t.prefix}…</code></span>
            <button onClick={() => revoke(t.id)} className="text-red-700 hover:underline">Revoke</button>
          </li>
        ))}
        {tokens.length === 0 && <li className="py-2 text-neutral-500">No tokens yet.</li>}
      </ul>
    </div>
  );
}
