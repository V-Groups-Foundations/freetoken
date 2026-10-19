'use client';

import { useState } from 'react';
import { toast } from '../fx';
import { useInVRun } from './launch';

/**
 * Sign V-Run in: create an ft_ token named "V-Run" and hand it straight to the app through the bridge it
 * injects into this page. Opened outside V-Run, the token is shown once to paste into V-Run's Settings.
 */
export function ConnectVRun() {
  const inVRun = useInVRun();
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setState('working');
    setError(null);
    try {
      const res = await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'V-Run' }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.token) throw new Error(j?.error ?? `Could not create a token (${res.status})`);
      if (window.vrun) {
        await window.vrun.connect(j.token);
        toast('V-Run is connected');
      } else setToken(j.token);
      setState('done');
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }

  return (
    <div className="card card-pad flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="font-medium">{state === 'done' && !token ? 'V-Run is connected ✓' : 'Connect V-Run to your account'}</div>
        <p className="muted text-sm">
          {state === 'done' && !token
            ? 'V-Run now uses your FreeToken models. You can close this page.'
            : inVRun
              ? 'One click: V-Run gets its own API token (you can revoke it any time under API).'
              : 'Creates an API token named “V-Run”. Open this page from V-Run (Settings → FreeToken) to connect without copying anything.'}
        </p>
        {token && (
          <div className="mt-2 space-y-1 text-sm">
            <div>Paste this into V-Run → Settings → FreeToken → API token. It is shown only once.</div>
            <code className="block break-all rounded bg-[var(--surface-2)] px-2 py-1 font-mono text-xs">{token}</code>
          </div>
        )}
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      </div>
      {!(state === 'done' && !token) && (
        <button onClick={connect} disabled={state === 'working'}
          className="rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-ink)] disabled:opacity-50">
          {state === 'working' ? 'Connecting…' : inVRun ? 'Connect V-Run' : 'Create a V-Run token'}
        </button>
      )}
    </div>
  );
}
