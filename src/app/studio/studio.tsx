'use client';

import { useState } from 'react';
import { PageHeader } from '../page-header';
import { toast } from '../fx';

const IDEAS = [
  'a snake game with arrow-key controls and a score',
  'a pomodoro timer with start/pause and a progress ring',
  'a memory card-matching game with emojis',
  'a tip calculator with a bill split slider',
];

export function StudioClient() {
  const [prompt, setPrompt] = useState('');
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);

  async function build(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/studio', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: clean }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.html !== 'string') {
        setError(data?.error?.message ?? 'Could not build that. Try rephrasing.');
        return;
      }
      setHtml(data.html);
      setProvider(data.provider ?? null);
      toast('Built');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  function downloadHtml() {
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'freetoken-app.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="free · runs on your chat models"
        title="Mini-app studio"
        subtitle="Describe a game or small app and FreeToken builds it, then runs it right here."
      />

      <form
        className="card card-pad flex flex-col gap-3"
        onSubmit={(e) => { e.preventDefault(); void build(prompt); }}
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="a breakout game with a paddle and bouncing ball…"
          className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm outline-none focus:border-[var(--brand)]"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="muted text-xs">Runs in a sandboxed frame — no network access.</span>
          <button type="submit" disabled={busy || !prompt.trim()} className="btn btn-primary">
            {busy ? 'Building…' : 'Build it'}
          </button>
        </div>
      </form>

      {!html && !busy && (
        <div className="flex flex-wrap gap-2">
          {IDEAS.map((i) => (
            <button key={i} type="button" onClick={() => setPrompt(i)} className="btn btn-ghost btn-sm">{i}</button>
          ))}
        </div>
      )}

      {error && <div className="card card-pad text-sm" style={{ color: 'var(--danger, #ef4444)' }}>{error}</div>}

      {busy && (
        <div className="card grid h-64 place-items-center">
          <div className="ft-caret muted text-sm">writing the code…</div>
        </div>
      )}

      {html && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            {provider && <span className="muted text-xs">Built by {provider}</span>}
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => void build(prompt)} className="btn btn-ghost btn-sm">Rebuild</button>
              <button type="button" onClick={downloadHtml} className="btn btn-ghost btn-sm">Download .html</button>
            </div>
          </div>
          <iframe
            title="Generated app"
            srcDoc={html}
            sandbox="allow-scripts allow-pointer-lock allow-modals"
            className="h-[70vh] w-full rounded-xl border border-[var(--border)] bg-white"
          />
        </div>
      )}
    </div>
  );
}
