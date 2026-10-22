'use client';

import { useEffect, useState } from 'react';
import { toast } from '../fx';

type Token = { id: number; name: string; prefix: string; lastUsedAt: string | null };

async function fetchTokens(): Promise<Token[]> {
  // a failed load is an empty list (and a note), not an error object the list can't render
  const r = await fetch('/api/tokens').catch(() => null);
  const j = r?.ok ? await r.json().catch(() => null) : null;
  if (!Array.isArray(j)) { toast("Couldn't load your tokens — reload the page to try again."); return []; }
  return j;
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
    const res = await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => null);
    if (!res) return toast("Couldn't reach FreeToken — is it still running?");
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? "Couldn't create the token — try again.");
    setFresh((await res.json()).token);
    setName('');
    void reload();
  }

  async function revoke(id: number) {
    const ok = await fetch(`/api/tokens?id=${id}`, { method: 'DELETE' }).then((r) => r.ok, () => false);
    if (!ok) toast("Couldn't revoke the token — try again.");
    void reload();
  }

  return (
    <div className="card card-pad space-y-4">
      <h2 className="font-semibold">API tokens</h2>
      {fresh && (
        <div className="rounded-xl bg-[var(--brand-tint)] p-3 text-sm text-[var(--brand-ink)]">
          Copy this token now — it won’t be shown again:
          <code className="mt-1.5 block break-all rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] p-2 font-mono text-xs">{fresh}</code>
        </div>
      )}
      <form onSubmit={create} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. laptop" className="input flex-1" />
        <button disabled={!name.trim()} className="btn btn-primary">Create</button>
      </form>
      <ul className="divide-y divide-[var(--border)] text-sm">
        {tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2.5">
            <span>{t.name} <code className="faint ml-1 font-mono text-xs">{t.prefix}…</code></span>
            <button onClick={() => revoke(t.id)} className="text-[var(--danger)] hover:underline">Revoke</button>
          </li>
        ))}
        {tokens.length === 0 && <li className="muted py-2.5">No tokens yet.</li>}
      </ul>
    </div>
  );
}
