'use client';

import { useEffect, useRef, useState } from 'react';
import { buildContent, readAttachment, MAX_ATTACHMENTS, type Attachment } from './attachments';
import { MicButton, DictateButton, SpeakButton } from './voice';
import { Markdown } from './markdown';
import { toast } from '../fx';

type Msg = { role: 'user' | 'assistant'; content: string; provider?: string };
type ChatRef = { id: string; title: string };

// Each provider answers in its own color, so a conversation shows the pool at work.
const PROVIDER_COLOR: Record<string, string> = {
  groq: '#f55036',
  gemini: '#1a73e8',
  openrouter: '#6467f2',
  nvidia: '#76b900',
  sambanova: '#ee7624',
  github: '#2b3137',
  cohere: '#ff6a5f',
};
const AUTO_COLOR = 'var(--brand)';

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

export function Chat({
  models,
  initialChats,
  activeId,
  initialMessages,
}: {
  models: { id: string; name: string }[];
  initialChats: ChatRef[];
  activeId: string | null;
  initialMessages: Msg[];
}) {
  const [chats, setChats] = useState<ChatRef[]>(initialChats);
  const [current, setCurrent] = useState<string | null>(activeId);
  const [model, setModel] = useState('auto-smart');
  const [msgs, setMsgs] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  function grow(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setReading(true);
    for (const file of Array.from(files)) {
      if (attachments.length >= MAX_ATTACHMENTS) {
        toast(`Up to ${MAX_ATTACHMENTS} attachments.`);
        break;
      }
      try {
        const att = await readAttachment(file);
        setAttachments((prev) => (prev.length >= MAX_ATTACHMENTS ? prev : [...prev, att]));
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not read that file.');
      }
    }
    setReading(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function newChat() {
    setCurrent(null);
    setMsgs([]);
    setError(null);
    taRef.current?.focus();
  }

  async function openChat(id: string) {
    if (id === current || busy) return;
    setCurrent(id);
    setError(null);
    setMsgs([]);
    try {
      const res = await fetch(`/api/chats/${id}/messages`);
      if (res.ok) setMsgs(await res.json());
    } catch {
      /* keep empty; the user can still type */
    }
  }

  async function deleteChat(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setChats((cs) => cs.filter((c) => c.id !== id));
    if (id === current) newChat();
    try {
      await fetch(`/api/chats/${id}`, { method: 'DELETE' });
    } catch {
      /* best effort */
    }
  }

  async function streamInto(chatId: string, history: Msg[], content: string | object[]) {
    const res = await fetch(`/api/chats/${chatId}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
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
  }

  async function submit(textValue: string) {
    const typed = textValue.trim();
    const atts = attachments;
    if ((!typed && atts.length === 0) || busy || reading) return;

    const richContent = buildContent(typed, atts);
    // The bubble shows the typed text plus a chip line for each attachment.
    const summary = atts.map((a) => (a.kind === 'image' ? `🖼️ ${a.name}` : `📄 ${a.name}`)).join('   ');
    const displayContent = [typed, summary].filter(Boolean).join('\n\n');
    const history: Msg[] = [...msgs, { role: 'user', content: displayContent }];

    setInput('');
    setAttachments([]);
    if (taRef.current) taRef.current.style.height = 'auto';
    setBusy(true);
    setError(null);
    setMsgs([...history, { role: 'assistant', content: '' }]);

    try {
      let chatId = current;
      // Lazily create the thread on the first message so empty chats never pile up.
      if (!chatId) {
        const res = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: typed || atts[0]?.name || 'New chat', model }),
        });
        if (!res.ok) throw new Error('Could not start a new chat.');
        const chat = await res.json();
        chatId = chat.id as string;
        setCurrent(chatId);
        setChats((cs) => [{ id: chat.id, title: chat.title }, ...cs]);
      }
      await streamInto(chatId, history, richContent);
    } catch (e) {
      setMsgs(history); // drop the partial answer; the user can retry
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
      taRef.current?.focus();
    }
  }

  async function changeModel(next: string) {
    setModel(next);
    if (current) {
      try {
        await fetch(`/api/chats/${current}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: next }),
        });
      } catch {
        /* best effort */
      }
    }
  }

  const activeLabel = models.find((m) => m.id === model)?.name;

  return (
    <div className="grid h-[calc(100vh-8.5rem)] gap-4 md:grid-cols-[15rem_1fr]">
      {/* Thread sidebar */}
      <aside className="hidden flex-col gap-3 md:flex">
        <button onClick={newChat} className="btn btn-primary w-full">
          <span className="text-lg leading-none">+</span> New chat
        </button>
        <div className="card flex-1 overflow-y-auto p-2">
          {chats.length === 0 ? (
            <p className="faint px-2 py-3 text-sm">Your chats will appear here.</p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => openChat(c.id)}
                    className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                      c.id === current
                        ? 'bg-[var(--brand-tint)] font-medium text-[var(--brand-ink)]'
                        : 'text-[var(--ink)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <span className="flex-1 truncate">{c.title}</span>
                    <span
                      onClick={(e) => deleteChat(c.id, e)}
                      className="shrink-0 rounded px-1 text-[var(--faint)] opacity-0 hover:text-[var(--danger)] group-hover:opacity-100"
                      aria-label="Delete chat"
                      role="button"
                    >
                      ×
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Conversation column */}
      <div className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between gap-3 pb-3">
          <label className="muted flex items-center gap-2 text-sm">
            <span className="hidden sm:inline">Model</span>
            <select value={model} onChange={(e) => changeModel(e.target.value)} className="select h-9 w-auto py-0 text-sm">
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
          <button onClick={newChat} className="btn btn-secondary btn-sm md:hidden">New chat</button>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="card flex-1 overflow-y-auto">
          {msgs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG logo */}
                <img src="/logo.svg" alt="FreeToken" width={48} height={48} className="mx-auto h-12 w-12" />

                <h1 className="text-2xl font-semibold tracking-tight">What can I help you with?</h1>
                <p className="muted max-w-md">
                  Your message goes to whichever of your connected providers has free quota right now
                  {activeLabel ? <> — currently <span className="text-[var(--ink)]">{activeLabel}</span></> : null}.
                </p>
              </div>
              <div className="flex w-full max-w-md flex-col gap-2">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => submit(ex)}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-left text-sm text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:bg-[var(--surface)]"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6 p-5 sm:p-7">
              {msgs.map((m, i) => {
                const streaming = busy && i === msgs.length - 1 && m.role === 'assistant';
                if (m.role === 'user') {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--brand)] px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-[var(--shadow-brand)]">
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
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                        style={{ backgroundColor: color }}
                      >
                        <span className="capitalize">{provider}</span>
                      </span>
                      {modelId && <span className="faint font-mono text-xs">{modelId}</span>}
                      {!streaming && m.content && <span className="ml-auto"><SpeakButton text={m.content} /></span>}
                    </div>
                    <div className={`pl-1 text-[var(--ink)] ${streaming && !m.content ? 'ft-caret' : ''}`}>
                      {m.content ? <Markdown>{m.content}</Markdown> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--accent-tint)] px-4 py-3 text-sm text-[var(--danger)]">
            <span>{error}</span>
            <button onClick={() => void submit(msgs[msgs.length - 1]?.content ?? '')} className="shrink-0 font-medium underline underline-offset-2">Try again</button>
          </div>
        )}

        {/* Composer */}
        <div className="mt-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-2 shadow-sm focus-within:border-[var(--brand)] focus-within:ring-2 focus-within:ring-[var(--brand)]/15">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2 px-1">
              {attachments.map((a) => (
                <span key={a.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] py-1 pl-1 pr-2 text-xs">
                  {a.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.dataUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-[var(--brand-tint)]">📄</span>
                  )}
                  <span className="max-w-[10rem] truncate text-[var(--ink)]">{a.name}</span>
                  <button onClick={() => removeAttachment(a.id)} className="text-[var(--faint)] hover:text-[var(--danger)]" aria-label={`Remove ${a.name}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.yml,.yaml,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.rb,.php,.sh,.sql,.html,.css"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy || reading}
              className="btn btn-ghost shrink-0 px-2.5 text-base"
              title="Attach images or documents"
              aria-label="Attach images or documents"
            >
              {reading ? '…' : '📎'}
            </button>
            <MicButton
              disabled={busy}
              onText={(text) => {
                setInput((v) => (v ? v.trimEnd() + ' ' : '') + text);
                if (taRef.current) { taRef.current.focus(); grow(taRef.current); }
              }}
            />
            <DictateButton
              disabled={busy}
              onText={(text) => {
                setInput((v) => (v ? v.trimEnd() + ' ' : '') + text);
                if (taRef.current) { taRef.current.focus(); grow(taRef.current); }
              }}
            />
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
              className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none"
            />
            <button onClick={() => submit(input)} disabled={busy || reading || (!input.trim() && attachments.length === 0)} className="btn btn-primary shrink-0">
              {busy ? 'Sending' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
