'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from '../../fx';

type Msg = { role: 'user' | 'assistant'; content: string; provider?: string };
type Model = { id: string; name: string };

const PROVIDER_COLOR: Record<string, string> = {
  groq: '#f55036', gemini: '#1a73e8', openrouter: '#6467f2',
  nvidia: '#76b900', sambanova: '#ee7624', github: '#2b3137',
};
const AUTO_COLOR = 'var(--brand)';
function provider(id: string | undefined) {
  if (!id) return { name: 'auto', model: '', color: AUTO_COLOR };
  const i = id.indexOf('/');
  const name = i > 0 ? id.slice(0, i) : id;
  return { name, model: i > 0 ? id.slice(i + 1) : '', color: PROVIDER_COLOR[name] ?? AUTO_COLOR };
}

export function Workspace({
  projectId, initialModel, models, initialMessages,
}: {
  projectId: string;
  initialModel: string;
  models: Model[];
  initialMessages: Msg[];
}) {
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat');
  const [model, setModel] = useState(initialModel);
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeModel(next: string) {
    setModel(next);
    await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: next }),
    }).catch(() => {});
  }

  async function send(content: string) {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const base = [...msgs, { role: 'user' as const, content: text }];
    setMsgs([...base, { role: 'assistant', content: '' }]);
    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `Request failed (${res.status})`);
      }
      const prov = res.headers.get('x-freetoken-provider') ?? undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let out = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (typeof delta === 'string') {
              out += delta;
              setMsgs([...base, { role: 'assistant', content: out, provider: prov }]);
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      setMsgs(msgs); // drop the failed turn
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 text-sm">
          {(['chat', 'terminal'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 capitalize ${tab === t ? 'bg-[var(--brand)] text-white' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <span>Model</span>
          <select
            value={model}
            onChange={(e) => changeModel(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--brand)] focus:outline-none"
          >
            <optgroup label="Automatic">
              <option value="auto-smart">Auto · best</option>
              <option value="auto-fast">Auto · fast</option>
            </optgroup>
            {models.length > 0 && (
              <optgroup label="Specific model">
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>
      </div>

      {tab === 'chat'
        ? <ChatPane msgs={msgs} busy={busy} onSend={send} />
        : <TerminalPane projectId={projectId} msgs={msgs} busy={busy} model={model} onSend={send} />}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--accent-tint)] px-4 py-3 text-sm text-[var(--danger)]">
          <span>{error}</span>
          <button onClick={() => send(msgs.at(-1)?.content ?? '')} className="shrink-0 font-medium underline">Try again</button>
        </div>
      )}
    </div>
  );
}

function Composer({ busy, onSend, placeholder }: { busy: boolean; onSend: (t: string) => void; placeholder: string }) {
  const [input, setInput] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="mt-3 flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm focus-within:border-[var(--brand)] focus-within:ring-2 focus-within:ring-[var(--brand)]/15">
      <textarea
        ref={ref}
        value={input}
        rows={1}
        onChange={(e) => {
          setInput(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = Math.min(e.target.scrollHeight, 180) + 'px';
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend(input);
            setInput('');
            if (ref.current) ref.current.style.height = 'auto';
          }
        }}
        placeholder={placeholder}
        className="max-h-[180px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none"
      />
      <button
        onClick={() => { onSend(input); setInput(''); if (ref.current) ref.current.style.height = 'auto'; }}
        disabled={busy || !input.trim()}
        className="shrink-0 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-ink)] disabled:opacity-40"
      >
        {busy ? 'Sending' : 'Send'}
      </button>
    </div>
  );
}

function ChatPane({ msgs, busy, onSend }: { msgs: Msg[]; busy: boolean; onSend: (t: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);
  return (
    <div className="flex h-[calc(100vh-15rem)] flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
        {msgs.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[var(--muted)]">
            Start the conversation. Whatever you say here is also visible in the Terminal tab.
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-5">
            {msgs.map((m, i) => {
              const streaming = busy && i === msgs.length - 1 && m.role === 'assistant';
              if (m.role === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--brand)] px-4 py-2.5 text-[15px] leading-relaxed text-white">{m.content}</div>
                  </div>
                );
              }
              const p = provider(m.provider);
              return (
                <div key={i} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ backgroundColor: p.color }} aria-hidden>
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm font-medium capitalize text-[var(--ink)]">{p.name}</span>
                    {p.model && <span className="font-mono text-xs text-[var(--faint)]">{p.model}</span>}
                  </div>
                  <div className={`whitespace-pre-wrap pl-8 text-[15px] leading-relaxed text-[var(--ink)] ${streaming && !m.content ? 'ft-caret' : ''}`}>
                    {m.content}{streaming && m.content ? <span className="ft-caret" /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <Composer busy={busy} onSend={onSend} placeholder="Send a message…  (Enter to send)" />
    </div>
  );
}

function TerminalPane({ projectId, msgs, busy, model, onSend }: { projectId: string; msgs: Msg[]; busy: boolean; model: string; onSend: (t: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const command = `freetoken --project ${projectId}`;
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      toast('Command copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-15rem)] flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
        <span className="text-[var(--muted)]">Open this project in your own terminal:</span>
        <code className="rounded bg-[#0f1320] px-2 py-1 font-mono text-xs text-[#cdd3e0]">{command}</code>
        <button onClick={copyCommand} className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--brand-ink)]">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="text-xs text-[var(--faint)]">same saved conversation as here</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-2xl bg-[#0f1320] p-4 font-mono text-[13px] leading-relaxed text-[#cdd3e0]">
        <div className="text-[#5b647e]">freetoken · {model} · shares memory with the Chat tab</div>
        {msgs.map((m, i) => {
          if (m.role === 'user') {
            return <div key={i} className="mt-3"><span className="text-[#67e8f9]">› </span><span className="text-[#e6e9f0]">{m.content}</span></div>;
          }
          const p = provider(m.provider);
          const streaming = busy && i === msgs.length - 1;
          return (
            <div key={i} className="mt-1">
              <span className="text-[#5b647e]">  ({p.name}{p.model ? '/' + p.model : ''})</span>
              <div className={`whitespace-pre-wrap text-[#cdd3e0] ${streaming && !m.content ? 'ft-caret' : ''}`}>{m.content}{streaming && m.content ? <span className="ft-caret" /> : null}</div>
            </div>
          );
        })}
      </div>
      <Composer busy={busy} onSend={onSend} placeholder="Type a command or message, then Enter…" />
    </div>
  );
}
