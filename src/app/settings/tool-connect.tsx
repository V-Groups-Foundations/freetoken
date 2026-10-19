'use client';

import { useEffect, useState } from 'react';
import { toast } from '../fx';

type Tool = {
  id: string; name: string; kind: 'auto' | 'assist';
  installed: boolean | null; connected: boolean; command?: string; note?: string; openUrl?: string;
};
type KeyInfo = { key: string; baseUrl: string; model: string };

const INSTALL: Record<string, string> = {
  'claude-code': 'https://docs.anthropic.com/en/docs/claude-code/setup',
  codex: 'https://github.com/openai/codex',
  aider: 'https://aider.chat/docs/install.html',
  continue: 'https://marketplace.visualstudio.com/items?itemName=Continue.continue',
};
const ICON: Record<string, string> = { 'claude-code': '✳', codex: '◎', aider: '◆', continue: '▶', freetoken: '$_', cursor: '⌖', cline: '⚡' };
const api = (body?: object) => fetch('/api/local/tools', {
  method: body ? 'POST' : 'GET',
  headers: { 'x-freetoken-ui': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }));

function Copy({ value, label }: { value: string; label?: string }) {
  return (
    <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(value).then(() => toast(`${label ?? 'Copied'} copied`))}>Copy</button>
  );
}

/**
 * One click per tool: FreeToken (running on this computer) sets the tool up itself — a command like
 * `claude-free`, a Codex profile, a Continue model. Cursor and Cline get a ready key and the values to paste.
 */
export function ToolConnect({ manual }: { manual: React.ReactNode }) {
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [keys, setKeys] = useState<Record<string, KeyInfo>>({});

  useEffect(() => {
    let live = true;
    api().then((r) => {
      if (!live) return;
      if (r.status === 403) setAvailable(false); // hosted FreeToken / not the owner: just the guides
      else if (r.ok) setTools(r.j.tools);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  async function act(t: Tool, action: 'connect' | 'disconnect' | 'key') {
    setBusy(t.id);
    const r = await api({ tool: t.id, action });
    setBusy(null);
    if (!r.ok) { toast(r.j.error ?? 'That didn\'t work'); return; }
    if (r.j.key) setKeys((k) => ({ ...k, [t.id]: { key: r.j.key, baseUrl: r.j.baseUrl, model: r.j.model } }));
    if (r.j.message) { setDone((d) => ({ ...d, [t.id]: r.j.message })); toast(r.j.message); }
    if (r.j.tools) setTools(r.j.tools);
  }

  if (!available) return <>{manual}</>;
  return (
    <div className="space-y-4">
      <div className="grid items-start gap-3 md:grid-cols-2">
        {(tools ?? []).map((t) => {
          const k = keys[t.id];
          return (
            <div key={t.id} className={`tile p-4 ${t.connected ? 'border-[color-mix(in_srgb,var(--ok)_45%,var(--border))]' : ''}`}>
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-mono text-sm font-bold" style={{ background: 'var(--brand-tint)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent)' }}>{ICON[t.id]}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-xs">
                    {t.connected ? <span className="text-[var(--ok)]">● Connected</span>
                      : t.installed === false ? <span className="faint">Not installed{INSTALL[t.id] && <> · <a className="underline" href={INSTALL[t.id]} target="_blank" rel="noreferrer">install it</a></>}</span>
                      : t.installed ? <span className="muted">Installed · not connected</span> : <span className="muted">{t.kind === 'assist' ? 'Paste three values' : 'Ready'}</span>}
                  </div>
                </div>
                {t.kind === 'auto' ? (
                  t.connected
                    ? <button className="btn btn-ghost btn-sm" disabled={busy === t.id} onClick={() => act(t, 'disconnect')}>Disconnect</button>
                    : <button className="btn btn-primary btn-sm" disabled={busy === t.id} onClick={() => act(t, 'connect')}>{busy === t.id ? 'Connecting…' : 'Connect'}</button>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={busy === t.id} onClick={() => act(t, 'key')}>{busy === t.id ? 'Creating…' : k ? 'New key' : 'Get a key'}</button>
                )}
              </div>
              {t.note && !k && <p className="muted mt-2.5 text-xs leading-relaxed">{t.note}</p>}
              {(t.connected || done[t.id]) && t.command && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--bg-deep)] px-3 py-2 font-mono text-xs">
                  <span className="text-[var(--faint)]">$</span><span className="flex-1">{t.command}</span><Copy value={t.command} label="Command" />
                </div>
              )}
              {k && (
                <div className="mt-3 space-y-2 text-xs">
                  {[['Base URL', k.baseUrl], ['API key', k.key], ['Model', k.model]].map(([label, value]) => (
                    <div key={label} className="flex items-center gap-2 rounded-lg bg-[var(--bg-deep)] px-3 py-2">
                      <span className="w-16 shrink-0 text-[var(--faint)]">{label}</span><code className="min-w-0 flex-1 truncate font-mono">{value}</code><Copy value={value} label={label} />
                    </div>
                  ))}
                  <p className="muted">
                    {t.id === 'cursor' ? 'In Cursor: Settings → Models → paste the API key as OpenAI API Key, turn on "Override OpenAI Base URL" with the base URL, and add the model auto-smart.'
                      : 'In Cline: API Provider → "OpenAI Compatible", then paste the base URL, API key and model ID.'}
                    {' '}The key is shown once; it&apos;s listed under API tokens if you want to revoke it.
                  </p>
                  {t.openUrl && <a className="btn btn-secondary btn-sm" href={t.openUrl}>Open {t.id === 'cursor' ? 'Cursor' : 'Cline in VS Code'} ↗</a>}
                </div>
              )}
            </div>
          );
        })}
        {!tools && [0, 1, 2, 3].map((i) => <div key={i} className="tile h-28 animate-pulse p-4" />)}
      </div>
      <details className="rounded-xl border border-[var(--border)] p-4">
        <summary className="cursor-pointer text-sm font-medium">Prefer to set it up by hand?</summary>
        <div className="mt-3">{manual}</div>
      </details>
    </div>
  );
}
