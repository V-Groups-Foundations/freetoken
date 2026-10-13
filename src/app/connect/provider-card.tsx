'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicProvider } from '@/providers/registry';

type Connected = { last4: string; status: string; excludedFromAuto: boolean } | null;

export function ProviderCard({ provider, connected, oauth = false }: { provider: PublicProvider; connected: Connected; oauth?: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: provider.id, key, extra: extra || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMessage({ kind: 'error', text: data.error ?? 'Something went wrong.' });
    setKey('');
    setExtra('');
    setMessage({ kind: 'ok', text: data.note ?? 'Connected.' });
    router.refresh();
  }

  async function remove() {
    await fetch(`/api/keys?provider=${provider.id}`, { method: 'DELETE' });
    router.refresh();
  }

  async function toggleExclude(excludedFromAuto: boolean) {
    await fetch('/api/keys', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: provider.id, excludedFromAuto }),
    });
    router.refresh();
  }

  const badge = !connected
    ? <span className="badge badge-off">Not connected</span>
    : connected.status === 'valid'
      ? <span className="badge badge-ok">Connected ••••{connected.last4}</span>
      : <span className="badge badge-bad">Key rejected</span>;

  return (
    <div className="card card-pad space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{provider.name}</h2>
        {badge}
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm muted">
        {provider.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-block text-sm font-medium text-[var(--brand)] hover:underline">
        Get your {provider.name} key
      </a>
      {provider.note && <p className="rounded-lg bg-[#fdf0da] p-2.5 text-xs text-[#96611a]">{provider.note}</p>}
      {oauth && (
        <div className="space-y-1.5">
          <a href="/api/connect/openrouter/start" className="btn btn-primary btn-sm w-full">
            {connected ? 'Reconnect with OpenRouter' : 'Connect with OpenRouter — one click'}
          </a>
          <p className="faint text-xs">Approve on OpenRouter, no copy-paste. Or paste a key below.</p>
        </div>
      )}
      <form onSubmit={save} className="space-y-2">
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={connected ? 'Paste a new key to replace' : 'Paste your API key'}
          className="input"
        />
        {provider.extraField && (
          <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={provider.extraField.label} className="input" />
        )}
        <button disabled={busy || !key} className="btn btn-secondary btn-sm">
          {busy ? 'Testing…' : 'Test & save'}
        </button>
      </form>
      {message && <p className={`text-sm ${message.kind === 'ok' ? 'text-[#15724a]' : 'text-[var(--danger)]'}`}>{message.text}</p>}
      {connected && (
        <div className="flex items-center justify-between border-t border-[var(--border)] pt-3 text-sm">
          <label className="muted flex items-center gap-2">
            <input type="checkbox" checked={connected.excludedFromAuto} onChange={(e) => toggleExclude(e.target.checked)} />
            Exclude from auto
          </label>
          <button onClick={remove} className="text-[var(--danger)] hover:underline">Remove</button>
        </div>
      )}
    </div>
  );
}
