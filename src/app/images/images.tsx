'use client';

/* eslint-disable @next/next/no-img-element -- generated images are base64 data URLs, not optimizable assets */

import { useRef, useState } from 'react';
import { PageHeader } from '../page-header';
import { toast } from '../fx';

interface GenImage {
  id: string;
  prompt: string;
  dataUrl: string;
}

const SUGGESTIONS = [
  'a cozy reading nook by a rainy window, warm lamplight',
  'an astronaut relaxing on a tropical beach, retro poster',
  'a neon-lit ramen stall in a cyberpunk alley at night',
  'a watercolor fox curled asleep in autumn leaves',
];

function download(image: GenImage) {
  const a = document.createElement('a');
  a.href = image.dataUrl;
  const slug = image.prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
  a.download = `freetoken-${slug}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type Engine = 'pollinations' | 'gemini';

export function ImageStudio({ geminiConnected = false }: { geminiConnected?: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GenImage[]>([]);
  const [engine, setEngine] = useState<Engine>('pollinations');
  const [style, setStyle] = useState<'flux' | 'turbo'>('flux');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function callEngine(prompt: string, which: Engine): Promise<{ dataUrl?: string; status: number; message?: string }> {
    const res = await fetch('/api/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, engine: which, model: which === 'pollinations' ? style : undefined }),
    });
    const data = await res.json().catch(() => null);
    return { dataUrl: data?.dataUrl, status: res.status, message: data?.error?.message };
  }

  async function generate(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      let result = await callEngine(clean, engine);

      // Gemini rate-limited, or the key is a free one (Google gives those no image quota: 402) — still
      // make the image, with the keyless FLUX engine, and say why
      if (!result.dataUrl && engine === 'gemini' && (result.status === 429 || result.status === 402)) {
        toast(result.status === 402 ? 'Gemini images need a paid key — made it with FLUX (free) instead' : 'Gemini was rate-limited — used FLUX instead');
        result = await callEngine(clean, 'pollinations');
      }

      if (!result.dataUrl) {
        setError(result.message ?? 'Something went wrong generating the image.');
        return;
      }
      setImages((prev) => [{ id: crypto.randomUUID(), prompt: clean, dataUrl: result.dataUrl! }, ...prev]);
      setPrompt('');
      toast('Image ready');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="free · no key needed"
        title="Image studio"
        subtitle="Describe a picture and FreeToken draws it with a free FLUX model — no provider to connect."
      />

      <form
        className="card card-pad flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void generate(prompt);
        }}
      >
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void generate(prompt);
            }
          }}
          rows={3}
          maxLength={2000}
          disabled={busy}
          placeholder="A golden retriever puppy wearing tiny sunglasses, studio photo…"
          className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)]"
        />
        {geminiConnected && (
          <div className="flex items-center gap-2 text-xs">
            <span className="muted">Engine</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setEngine('pollinations')}
                data-active={engine === 'pollinations'}
                className="px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white"
              >
                FLUX (free)
              </button>
              <button
                type="button"
                onClick={() => setEngine('gemini')}
                data-active={engine === 'gemini'}
                title="Needs a paid Gemini key (billing on) — free keys get no image quota from Google"
                className="px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white"
              >
                Gemini (paid key)
              </button>
            </div>
          </div>
        )}
        {geminiConnected && engine === 'gemini' && (
          <p role="note" className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
            Gemini images need a <b>paid</b> Gemini key: Google gives free keys no image quota (yours still works for chat).
            Turn on billing for it in Google AI Studio — or use <b>FLUX</b>, which is free with no key. With a free key, FreeToken makes the image with FLUX instead.
          </p>
        )}
        {engine === 'pollinations' && (
          <div className="flex items-center gap-2 text-xs">
            <span className="muted">Style</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)]">
              <button type="button" onClick={() => setStyle('flux')} data-active={style === 'flux'}
                className="px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white">
                Flux · best
              </button>
              <button type="button" onClick={() => setStyle('turbo')} data-active={style === 'turbo'}
                className="px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white">
                Turbo · fast
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="muted text-xs">⌘/Ctrl + Enter to generate</span>
          <button type="submit" disabled={busy || !prompt.trim()} className="btn btn-primary">
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </form>

      {error && (
        <div className="card card-pad border-[var(--danger,#ef4444)] text-sm" style={{ color: 'var(--danger, #ef4444)' }}>
          {error}
        </div>
      )}

      {images.length === 0 && !busy && (
        <div className="flex flex-col gap-3">
          <p className="muted text-sm">Try one of these to start:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setPrompt(s);
                  inputRef.current?.focus();
                }}
                className="btn btn-ghost btn-sm text-left"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {busy && (
        <div className="card grid aspect-square w-full max-w-sm place-items-center">
          <div className="ft-caret muted text-sm">painting your image…</div>
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((img) => (
            <figure key={img.id} className="card overflow-hidden">
              <img src={img.dataUrl} alt={img.prompt} className="aspect-square w-full object-cover" />
              <figcaption className="flex flex-col gap-2 p-3">
                <p className="line-clamp-2 text-xs" title={img.prompt}>{img.prompt}</p>
                <button type="button" onClick={() => download(img)} className="btn btn-ghost btn-sm self-start">
                  Download
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
