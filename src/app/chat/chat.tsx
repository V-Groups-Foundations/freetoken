'use client';

import { useState } from 'react';

type Msg = { role: 'user' | 'assistant'; content: string; provider?: string };

export function Chat({ models }: { models: { id: string; name: string }[] }) {
  const [model, setModel] = useState('auto-smart');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // Mid-stream failures drop the partial answer; the user retries.
      setMsgs(history);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: input.trim() }];
    setInput('');
    void send(history);
  }

  return (
    <section className="flex h-[75vh] flex-col gap-4">
      <select value={model} onChange={(e) => setModel(e.target.value)} className="w-fit rounded border px-2 py-1 text-sm">
        <option value="auto-smart">Auto (smart)</option>
        <option value="auto-fast">Auto (fast)</option>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <div className="flex-1 space-y-4 overflow-y-auto rounded-xl border bg-white p-4">
        {msgs.length === 0 && <p className="text-sm text-neutral-500">Ask anything. Requests go to whichever of your providers has free quota.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-left ${m.role === 'user' ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}>
              {m.content || (busy && i === msgs.length - 1 ? '…' : '')}
            </div>
            {m.provider && <div className="mt-1 text-xs text-neutral-400">via {m.provider}</div>}
          </div>
        ))}
      </div>
      {error && (
        <div className="flex items-center justify-between rounded bg-red-50 p-3 text-sm text-red-800">
          <span>{error}</span>
          <button onClick={() => send(msgs)} className="font-medium underline">Retry</button>
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message" className="flex-1 rounded-lg border px-3 py-2" />
        <button disabled={busy || !input.trim()} className="rounded-lg bg-neutral-900 px-4 py-2 text-white disabled:opacity-40">Send</button>
      </form>
    </section>
  );
}
