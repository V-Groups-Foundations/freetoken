'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { providerForKey } from '@/keys/detect';
import { toast } from '../fx';

type Result = { provider: string; name: string; source: string; ok: boolean; error: string | null };
type EnvKey = { provider: string; name: string; source: string; masked: string };

const FAST = [
  { id: 'gemini', name: 'Google Gemini', url: 'https://aistudio.google.com/apikey', how: 'Sign in with Google → "Create API key" → copy', time: '~1 min' },
  { id: 'groq', name: 'Groq', url: 'https://console.groq.com/keys', how: 'Sign in → "Create API Key" → copy', time: '~1 min' },
];

/**
 * The fast path at the top of Connect: chat works already (built-in starter); the quickest free keys
 * are one click each — open the provider, copy the key, come back and it's added automatically from
 * the clipboard; or paste anything (keys, a .env file) and every key in it is recognised and tested.
 */
export function QuickConnect({ welcome, starterOn, connected }: { welcome: boolean; starterOn: boolean; connected: string[] }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [unrecognized, setUnrecognized] = useState(0);
  const [envKeys, setEnvKeys] = useState<EnvKey[]>([]);
  const [waiting, setWaiting] = useState<string | null>(null); // provider we're waiting to see on the clipboard
  const waitingRef = useRef<string | null>(null);

  useEffect(() => {
    fetch('/api/keys/import').then((r) => r.json()).then((j) => setEnvKeys((j.found ?? []).filter((k: EnvKey) => !connected.includes(k.provider)))).catch(() => {});
  }, [connected]);

  const importKeys = useCallback(async (body: { text?: string; fromEnv?: boolean }) => {
    setBusy(true);
    setResults(null);
    try {
      const res = await fetch('/api/keys/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? 'Import failed');
      setResults(j.results);
      setUnrecognized(j.unrecognized ?? 0);
      const ok = (j.results as Result[]).filter((r) => r.ok);
      if (ok.length) { toast(`Connected ${ok.map((r) => r.name).join(', ')}`); setText(''); router.refresh(); }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Import failed');
    }
    setBusy(false);
  }, [router]);

  // After "Get key", watch for the user coming back with the key on their clipboard
  useEffect(() => {
    async function onFocus() {
      const want = waitingRef.current;
      if (!want) return;
      try {
        const clip = (await navigator.clipboard.readText()).trim();
        if (providerForKey(clip) === want) {
          waitingRef.current = null;
          setWaiting(null);
          await importKeys({ text: clip });
        }
      } catch { /* clipboard permission denied: the paste box still works */ }
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [importKeys]);

  function getKey(id: string, url: string) {
    waitingRef.current = id;
    setWaiting(id);
    window.open(url, '_blank', 'noopener');
  }

  const detected = text.trim() ? text.split(/[\s,;]+/).map((t) => providerForKey(t.replace(/^.*?[=:]\s*/, '').replace(/['"]/g, ''))).filter(Boolean).length : 0;

  return (
    <div className="space-y-4">
      {starterOn && (
        <div className={`card card-pad flex flex-wrap items-center justify-between gap-3 ${welcome ? 'border-[color-mix(in_srgb,var(--brand)_55%,var(--border))]' : ''}`}>
          <div>
            <div className="font-semibold">{welcome ? "You're in — and you can chat right now. 🎉" : 'Chat works right now'}</div>
            <p className="muted text-sm">The built-in starter model needs no key. Add free keys below for faster, smarter models and much higher limits.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/chat" className="btn btn-primary">Start chatting →</Link>
            <Link href="/v-run" className="btn btn-secondary">V-Run</Link>
          </div>
        </div>
      )}

      <div className="card card-pad space-y-4">
        <div>
          <span className="eyebrow">quick connect</span>
          <h2 className="h2 mt-1.5">Add free keys in about a minute each</h2>
          <p className="muted mt-1 text-sm">Click <b>Get key</b>, create the key on the provider&apos;s page and copy it — when you come back here it&apos;s added automatically.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {FAST.map((p) => {
            const done = connected.includes(p.id);
            return (
              <div key={p.id} className="rounded-xl border border-[var(--border)] p-3">
                <div className="flex items-center justify-between"><b>{p.name}</b><span className="faint text-xs">{p.time}</span></div>
                <p className="muted mt-1 text-xs">{p.how}</p>
                {done ? <div className="mt-2 text-sm text-[var(--brand)]">✓ Connected</div>
                  : waiting === p.id ? <div className="mt-2 text-xs text-[var(--brand)]">Waiting for you to copy the key… <button className="underline" onClick={() => { waitingRef.current = null; setWaiting(null); }}>cancel</button></div>
                  : <button className="btn btn-secondary btn-sm mt-2 w-full" onClick={() => getKey(p.id, p.url)}>Get key ↗</button>}
              </div>
            );
          })}
          <div className="rounded-xl border border-[var(--border)] p-3">
            <div className="flex items-center justify-between"><b>OpenRouter</b><span className="faint text-xs">1 click</span></div>
            <p className="muted mt-1 text-xs">Approve on OpenRouter — no key to copy.</p>
            {connected.includes('openrouter') ? <div className="mt-2 text-sm text-[var(--brand)]">✓ Connected</div>
              : <a href="/api/connect/openrouter/start" className="btn btn-secondary btn-sm mt-2 w-full">Connect ↗</a>}
          </div>
        </div>

        {envKeys.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--brand-tint)] p-3 text-sm">
            <div><b>Found on this computer:</b> {envKeys.map((k) => `${k.name} (${k.source})`).join(', ')}</div>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => importKeys({ fromEnv: true })}>Import {envKeys.length === 1 ? 'it' : `all ${envKeys.length}`}</button>
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="paste-keys">Already have keys? Paste them all at once</label>
          <textarea id="paste-keys" value={text} onChange={(e) => setText(e.target.value)} rows={3} spellCheck={false}
            placeholder={'One key, several keys, or a whole .env file:\nGROQ_API_KEY=gsk_…\nGEMINI_API_KEY=AIza…'}
            className="input min-h-[84px] w-full font-mono text-xs" />
          <div className="flex items-center gap-3">
            <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => importKeys({ text })}>{busy ? 'Testing keys…' : 'Add keys'}</button>
            {text.trim() && <span className="faint text-xs">{detected ? `${detected} key${detected === 1 ? '' : 's'} recognised so far` : 'Paste keys or KEY=value lines'}</span>}
          </div>
          {results && (
            <ul className="space-y-1 text-sm">
              {results.map((r) => <li key={r.provider}>{r.ok ? '✓' : '✗'} <b>{r.name}</b> <span className="faint">({r.source})</span>{r.error && <span className="text-[var(--danger)]"> — {r.error}</span>}</li>)}
              {results.length === 0 && <li className="muted">No keys recognised. Paste the key itself, or a line like <code>GROQ_API_KEY=…</code>.</li>}
              {unrecognized > 0 && results.length > 0 && <li className="faint text-xs">{unrecognized} line{unrecognized === 1 ? '' : 's'} weren&apos;t recognised and were skipped.</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
