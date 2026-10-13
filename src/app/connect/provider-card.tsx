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
    ? <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">Not connected</span>
    : connected.status === 'valid'
      ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Connected ••••{connected.last4}</span>
      : <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">Key rejected, paste a new one</span>;

  return (
    <div className="space-y-3 rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{provider.name}</h2>
        {badge}
      </div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-600">
        {provider.steps.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-block text-sm font-medium text-blue-700 underline">
        Get your {provider.name} key ↗
      </a>
      {provider.note && <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">{provider.note}</p>}
      {oauth && (
        <div className="space-y-1">
          <a href="/api/connect/openrouter/start" className="inline-block rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">
            {connected ? 'Reconnect with OpenRouter' : 'Connect with OpenRouter (one click)'}
          </a>
          <p className="text-xs text-neutral-400">Approve on OpenRouter — no copy-paste. Or paste a key below.</p>
        </div>
      )}
      <form onSubmit={save} className="space-y-2">
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={connected ? 'Paste a new key to replace' : 'Paste your API key'}
          className="w-full rounded border px-3 py-2 text-sm"
        />
        {provider.extraField && (
          <input
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder={provider.extraField.label}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        )}
        <button disabled={busy || !key} className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">
          {busy ? 'Testing…' : 'Test & save'}
        </button>
      </form>
      {message && <p className={`text-sm ${message.kind === 'ok' ? 'text-green-700' : 'text-red-700'}`}>{message.text}</p>}
      {connected && (
        <div className="flex items-center justify-between border-t pt-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={connected.excludedFromAuto} onChange={(e) => toggleExclude(e.target.checked)} />
            Exclude from auto-routing
          </label>
          <button onClick={remove} className="text-red-700 hover:underline">Remove</button>
        </div>
      )}
    </div>
  );
}
