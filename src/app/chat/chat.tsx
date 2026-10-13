'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string; provider?: string };

// Each provider answers in its own color, so a conversation shows the pool at work.
const PROVIDER_COLOR: Record<string, string> = {
  groq: '#f55036',
  gemini: '#1a73e8',
  openrouter: '#6467f2',
  cloudflare: '#f38020',
  cerebras: '#d97706',
  mistral: '#fa520f',
  github: '#2b3137',
};
const AUTO_COLOR = '#0f766e';

function providerName(id: string | undefined): { provider: string; model: string; color: string } {
  if (!id) return { provider: 'auto', model: '', color: AUTO_COLOR };
  const slash = id.indexOf('/');
  const provider = slash > 0 ? id.slice(0, slash) : id;
  const model = slash > 0 ? id.slice(slash + 1) : '';
  return { provider, model, color: PROVIDER_COLOR[provider] ?? AUTO_COLOR };
}

const EXAMPLES = [
  'Explain closures in JavaScript with a tiny example.',
  'Draft a friendly out-of-office reply for next week.',
  'What should I ask when reviewing a database schema?',
];

export function Chat({ models }: { models: { id: string; name: string }[] }) {
  const [model, setModel] = useState('auto-smart');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  function grow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  async function send(history: Msg[]) {
    setBusy(true);
    setError(null);
    setMsgs([...history, { role: 'assistant', content: '' }]);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `Request failed (${res.status})`);
      }
      const provider = res.headers.get('x-freetoken-provider') ?? undefined;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
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
              text += delta;
              setMsgs([...history, { role: 'assistant', content: text, provider }]);
            }
          } catch {
            // ignore keep-alive or malformed lines
          }
        }
      }
    } catch (e) {
      setMsgs(history); // drop the partial answer; the user can retry
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  function submit(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content }];
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    void send(history);
  }

  const activeLabel = models.find((m) => m.id === model)?.name;

  return (
    <div className="mx-auto flex h-[calc(100vh-7.5rem)] max-w-3xl flex-col">
      {/* Control strip */}
      <div className="flex items-center justify-between gap-3 pb-3">
        <label className="flex items-center gap-2 text-sm text-[#697086]">
          <span>Model</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-lg border border-[#e3e6ee] bg-white px-2.5 py-1.5 text-sm text-[#232a3b] shadow-sm focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20"
          >
            <optgroup label="Automatic">
              <option value="auto-smart">Auto · best available</option>
              <option value="auto-fast">Auto · fastest</option>
            </optgroup>
            {models.length > 0 && (
              <optgroup label="Specific model">
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {msgs.length > 0 && (
          <button
            onClick={() => { setMsgs([]); setError(null); }}
            className="rounded-lg px-3 py-1.5 text-sm text-[#697086] hover:bg-white hover:text-[#232a3b]"
          >
            New chat
          </button>
        )}
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-2xl border border-[#e3e6ee] bg-white">
        {msgs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-[#232a3b]">What can I help you with?</h1>
              <p className="max-w-md text-[#697086]">
                Your message goes to whichever of your connected providers has free quota right now
                {activeLabel ? <> — currently <span className="text-[#232a3b]">{activeLabel}</span></> : null}.
              </p>
            </div>
            <div className="flex w-full max-w-md flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => submit(ex)}
                  className="rounded-xl border border-[#e3e6ee] bg-[#f7f8fb] px-4 py-3 text-left text-sm text-[#3c4252] transition-colors hover:border-[#cfd4e2] hover:bg-white"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-5 sm:p-6">
            {msgs.map((m, i) => {
              const streaming = busy && i === msgs.length - 1 && m.role === 'assistant';
              if (m.role === 'user') {
                return (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[#24324a] px-4 py-2.5 text-[15px] leading-relaxed text-white">
                      {m.content}
                    </div>
                  </div>
                );
              }
              const { provider, model: modelId, color } = providerName(m.provider);
              return (
                <div key={i} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    >
                      {provider.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm font-medium capitalize text-[#232a3b]">{provider}</span>
                    {modelId && <span className="font-mono text-xs text-[#9aa0b2]">{modelId}</span>}
                  </div>
                  <div
                    className={`whitespace-pre-wrap pl-8 text-[15px] leading-relaxed text-[#2c3242] ${streaming && !m.content ? 'ft-caret' : ''}`}
                  >
                    {m.content}
                    {streaming && m.content ? <span className="ft-caret" /> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#f3c9c2] bg-[#fdf1ef] px-4 py-3 text-sm text-[#9a2b1a]">
          <span>{error}</span>
          <button onClick={() => send(msgs)} className="shrink-0 font-medium underline underline-offset-2">Try again</button>
        </div>
      )}

      {/* Composer */}
      <div className="mt-3 flex items-end gap-2 rounded-2xl border border-[#e3e6ee] bg-white p-2 shadow-sm focus-within:border-[#0f766e] focus-within:ring-2 focus-within:ring-[#0f766e]/15">
        <textarea
          ref={taRef}
          value={input}
          rows={1}
          onChange={(e) => { setInput(e.target.value); grow(e.target); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(input);
            }
          }}
          placeholder="Send a message…  (Enter to send, Shift+Enter for a new line)"
          className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-[#232a3b] placeholder:text-[#9aa0b2] focus:outline-none"
        />
        <button
          onClick={() => submit(input)}
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-xl bg-[#0f766e] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0c5f58] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Sending' : 'Send'}
        </button>
      </div>
    </div>
  );
}
