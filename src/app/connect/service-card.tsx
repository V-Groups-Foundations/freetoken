'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicService } from '@/services/registry';
import { confetti, toast } from '../fx';

type Connected = { last4: string; status: string } | null;

export function ServiceCard({ service, connected }: { service: PublicService; connected: Connected }) {
  const router = useRouter();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    // the button must never stay stuck on "busy": a dropped connection is an error too
    const res = await fetch('/api/services', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ service: service.id, key }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res) return setMessage({ kind: 'error', text: "Couldn't reach FreeToken — is it still running?" });
    if (!res.ok) return setMessage({ kind: 'error', text: data.error ?? 'Something went wrong.' });
    setKey('');
    setMessage({ kind: 'ok', text: data.note ?? 'Connected.' });
    const card = cardRef.current;
    if (card) {
      card.classList.remove('ft-pop');
      void card.offsetWidth; // restart the animation
      card.classList.add('ft-pop');
    }
    confetti(card);
    toast(`${service.name} connected 🎉`);
    router.refresh();
  }

  async function remove() {
    const ok = await fetch(`/api/services?service=${service.id}`, { method: 'DELETE' }).then((r) => r.ok, () => false);
    if (!ok) toast(`Couldn't disconnect ${service.name} — try again.`);
    router.refresh();
  }

  const isConnected = connected?.status === 'valid';
  const badge = !connected
    ? <span className="badge badge-off">Not connected</span>
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
            {service.name.slice(0, 1)}
          </span>
          <div>
            <h2 className="font-semibold leading-tight">{service.name}</h2>
            <span className="muted mt-0.5 block text-xs">{service.kindLabel}</span>
          </div>
        </div>
        {badge}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="badge badge-ok !bg-transparent !px-0 !text-[var(--accent-ink)]">● Free</span>
        <span className="muted text-xs">· {service.freeTier}</span>
      </div>

      <a href={service.keyUrl} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm w-full">
        Open {service.name} key page ↗
      </a>

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
            {service.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          {service.note && <p className="muted mt-2 text-xs leading-relaxed">{service.note}</p>}
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
        <button disabled={busy || !key} className="btn btn-primary btn-sm w-full">
          {busy ? 'Testing…' : 'Test & save'}
        </button>
      </form>

      {message && (
        <p className={`text-sm ${message.kind === 'ok' ? 'text-[var(--accent-ink)]' : 'text-[var(--danger)]'}`}>{message.text}</p>
      )}
      {connected && (
        <div className="flex items-center justify-end border-t border-[var(--border)] pt-3 text-sm">
          <button onClick={remove} className="text-[var(--danger)] hover:underline">Remove</button>
        </div>
      )}
    </div>
  );
}
