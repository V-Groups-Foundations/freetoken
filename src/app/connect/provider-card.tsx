'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicProvider } from '@/providers/registry';
import { confetti, toast } from '../fx';

type Connected = { last4: string; status: string; excludedFromAuto: boolean } | null;

export function ProviderCard({ provider, connected, oauth = false }: { provider: PublicProvider; connected: Connected; oauth?: boolean }) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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
    const card = cardRef.current;
    if (card) {
      card.classList.remove('ft-pop');
      void card.offsetWidth; // restart the animation
      card.classList.add('ft-pop');
    }
    confetti(card);
    toast(`${provider.name} connected 🎉`);
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

  const isConnected = connected?.status === 'valid';
  const needs = provider.extraField ? `API key + ${provider.extraField.label}` : 'API key';
  const badge = !connected
    ? provider.keyless
      ? <span className="badge badge-ok" title="Used automatically; add a key only for higher limits">Works — no key needed</span>
      : <span className="badge badge-off">Not connected</span>
    : isConnected
      ? <span className="badge badge-ok">••••{connected.last4}</span>
      : <span className="badge badge-bad">Key rejected</span>;

  return (
    <div ref={cardRef} data-connected={isConnected} className="tile card-pad flex flex-col gap-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="grad flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-[var(--shadow-brand)]"
            aria-hidden
          >
            {provider.name.slice(0, 1)}
          </span>
          <div>
            <h2 className="font-semibold leading-tight">{provider.name}</h2>
            <span className="badge badge-ok mt-0.5 !bg-transparent !px-0 !text-[var(--accent-ink)]">● Free tier</span>
          </div>
        </div>
        {badge}
      </div>

      {/* Primary call to action: open the provider's key page */}
      <a
        href={provider.keyUrl}
        target="_blank"
        rel="noreferrer"
        className="btn btn-primary btn-sm w-full"
      >
        Open {provider.name} key page ↗
      </a>

      {/* Collapsible step-by-step guide */}
      <button
        type="button"
        onClick={() => setShowGuide((v) => !v)}
        className="faint flex items-center justify-between text-xs font-medium hover:text-[var(--ink)]"
        aria-expanded={showGuide}
      >
        <span>How to get your key &amp; what to paste</span>
        <span>{showGuide ? '▲' : '▼'}</span>
      </button>
      {showGuide && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-[var(--muted)]">
            {provider.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          <p className="mt-2.5 border-t border-[var(--border)] pt-2 text-xs">
            <span className="muted">You&apos;ll paste: </span>
            <span className="font-medium text-[var(--ink)]">{needs}</span>
          </p>
          {provider.note && <p className="muted mt-2 text-xs leading-relaxed">{provider.note}</p>}
        </div>
      )}

      {oauth && (
        <div className="space-y-1.5">
          <a href="/api/connect/openrouter/start" className="btn btn-secondary btn-sm w-full">
            {connected ? 'Reconnect with OpenRouter' : 'Connect with one click (OAuth)'}
          </a>
          <p className="faint text-xs">Approve on OpenRouter — no copy-paste. Or paste a key below.</p>
        </div>
      )}

      <form onSubmit={save} className="mt-auto space-y-2">
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={connected ? 'Paste a new key to replace' : 'Paste your API key'}
          className="input"
        />
        {provider.extraField && (
          <div className="space-y-1">
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder={provider.extraField.label} className="input" />
            {provider.extraField.hint && <p className="faint text-xs">{provider.extraField.hint}</p>}
          </div>
        )}
        <button disabled={busy || !key} className="btn btn-primary btn-sm w-full">
          {busy ? 'Testing…' : 'Test & save'}
        </button>
      </form>

      {message && (
        <p className={`text-sm ${message.kind === 'ok' ? 'text-[var(--accent-ink)]' : 'text-[var(--danger)]'}`}>{message.text}</p>
      )}
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
