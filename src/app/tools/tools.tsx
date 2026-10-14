'use client';

import { useState } from 'react';
import { TOOLS, type ToolId } from '@/tools/registry';
import { looksJapanese } from '@/tools/japanese';
import { PageHeader } from '../page-header';
import { toast } from '../fx';

function prettyIfJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function ToolsClient() {
  const [activeId, setActiveId] = useState<ToolId>('extract');
  const [input, setInput] = useState('');
  const [option, setOption] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [romaji, setRomaji] = useState<string | null>(null);
  const [romajiBusy, setRomajiBusy] = useState(false);

  const tool = TOOLS.find((t) => t.id === activeId)!;

  async function fetchRomaji(japanese: string) {
    setRomajiBusy(true);
    try {
      const res = await fetch('/api/romaji', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: japanese.slice(0, 4000) }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.romaji) setRomaji(String(data.romaji));
    } catch {
      // Romaji is a nice-to-have; silently skip if it fails.
    } finally {
      setRomajiBusy(false);
    }
  }

  async function run() {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    setOutput('');
    setRomaji(null);
    try {
      const res = await fetch('/api/tools', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tool: activeId, input, option }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.output !== 'string') {
        setError(data?.error?.message ?? 'The tool failed. Try again.');
        return;
      }
      const out = tool.jsonMode ? prettyIfJson(data.output) : data.output;
      setOutput(out);
      // For a Japanese translation, also offer a romaji reading below.
      if (activeId === 'translate' && looksJapanese(out)) void fetchRomaji(out);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="free · runs on your chat models"
        title="Tools"
        subtitle="Fast, focused text transforms that run on your connected models."
      />

      <div className="flex flex-wrap gap-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setActiveId(t.id); setOutput(''); setError(null); setOption(''); setRomaji(null); }}
            className={`btn btn-sm ${t.id === activeId ? 'btn-primary' : 'btn-ghost'}`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="card card-pad flex flex-col gap-3">
        <p className="muted text-sm">{tool.description}</p>
        {tool.option && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{tool.option.label}</span>
            <input
              value={option}
              onChange={(e) => setOption(e.target.value)}
              placeholder={tool.option.placeholder}
              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--brand)]"
            />
          </label>
        )}
        {tool.presets && (
          <div className="flex flex-wrap gap-1.5">
            <span className="faint self-center text-xs">Presets:</span>
            {tool.presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setOption(p.value)}
                className="btn btn-ghost btn-sm"
                title={p.value}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={8}
          placeholder="Paste your text here…"
          className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm outline-none focus:border-[var(--brand)]"
        />
        <div className="flex justify-end">
          <button type="button" onClick={run} disabled={busy || !input.trim()} className="btn btn-primary">
            {busy ? 'Running…' : `Run ${tool.name}`}
          </button>
        </div>
      </div>

      {error && <div className="card card-pad text-sm" style={{ color: 'var(--danger, #ef4444)' }}>{error}</div>}

      {output && (
        <div className="card card-pad flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="muted text-xs font-medium uppercase tracking-wide">Result</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { void navigator.clipboard?.writeText(output); toast('Copied'); }}
            >
              Copy
            </button>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-sm">{output}</pre>
        </div>
      )}

      {(romaji || romajiBusy) && (
        <div className="card card-pad flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="muted text-xs font-medium uppercase tracking-wide">Romaji</span>
            {romaji && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { void navigator.clipboard?.writeText(romaji); toast('Copied'); }}
              >
                Copy
              </button>
            )}
          </div>
          {romajiBusy && !romaji
            ? <p className="ft-caret muted text-sm">romanizing…</p>
            : <p className="whitespace-pre-wrap break-words text-sm">{romaji}</p>}
        </div>
      )}
    </div>
  );
}
