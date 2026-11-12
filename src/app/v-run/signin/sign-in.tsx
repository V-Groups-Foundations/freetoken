'use client';

import { useState } from 'react';

/** One click: make V-Run's API token and send it to the app (vrun://connect). */
export function SignInVRun({ state }: { state: string }) {
  const [phase, setPhase] = useState<'idle' | 'working' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  async function connect() {
    setPhase('working');
    setError(null);
    try {
      const res = await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'V-Run' }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.token) throw new Error(j?.error ?? `Could not create a token (${res.status})`);
      window.location.href = `vrun://connect?token=${encodeURIComponent(j.token)}&state=${encodeURIComponent(state)}`;
      setPhase('sent');
    } catch (e) {
      setPhase('idle');
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  }
  return (
    <section className="mx-auto max-w-md py-10">
      <div className="card card-pad space-y-4">
        <h1 className="h2">{phase === 'sent' ? 'V-Run is connected' : 'Sign V-Run in'}</h1>
        <p className="muted text-sm">
          {phase === 'sent'
            ? 'Go back to V-Run — it uses your FreeToken models now. You can close this tab. (If your browser asked whether to open V-Run, allow it.)'
            : 'V-Run gets its own API token for your account, so it can use your FreeToken models. You can revoke it any time under API.'}
        </p>
        {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
        {phase !== 'sent' && (
          <button onClick={connect} disabled={phase === 'working'} className="btn btn-primary w-full">
            {phase === 'working' ? 'Connecting…' : 'Connect V-Run'}
          </button>
        )}
      </div>
    </section>
  );
}
