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

type Engine = 'pollinations' | 'gemini' | 'cloudflare';
type Mode = 'create' | 'edit';

/** A picture to edit, already shrunk to fit 1024px (smaller upload, fewer Cloudflare Neurons). */
interface Pic {
  dataUrl: string;
  width: number;
  height: number;
}

/** Loads a file or data URL, shrinks it to fit 1024px and re-encodes it as JPEG. */
function loadPicture(src: string): Promise<Pic> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no canvas'));
      ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black as JPEG
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.9), width, height });
    };
    img.onerror = () => reject(new Error('unreadable'));
    img.src = src;
  });
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** One-click edits. `two` = needs the second picture (and the consent tick). */
const EDIT_PRESETS: { label: string; prompt: string; two?: boolean }[] = [
  { label: 'Anime style', prompt: 'Turn this picture into an anime illustration. Keep the same person, pose and composition.' },
  { label: 'Wear a suit', prompt: 'Dress the person in a sharp, well-fitted dark business suit with a white shirt and tie. Keep their face, pose and the background unchanged.' },
  { label: 'Fighting pose', prompt: 'Show the person in a dynamic martial-arts fighting stance, mid-action, with motion and energy. Keep their face, hair and clothing recognizable.' },
  { label: 'Watercolor', prompt: 'Repaint this picture as a soft watercolor painting. Keep the same subject and composition.' },
  { label: '3D cartoon', prompt: 'Turn this picture into a colorful 3D animated-movie style render. Keep the same person, expression and composition.' },
  { label: 'Pencil sketch', prompt: 'Turn this picture into a detailed black-and-white pencil sketch. Keep the same subject and composition.' },
  { label: 'Beach background', prompt: 'Replace the background with a sunny tropical beach. Keep the person exactly as they are, with matching lighting.' },
  { label: 'Face swap', two: true, prompt: "Replace the face of the person in the first image with the face of the person in the second image. Keep the first image's hair, pose, clothing, lighting and background." },
  { label: 'Put them together', two: true, prompt: 'Put the person from the second image next to the person in the first image, in the same scene and lighting, as if photographed together.' },
];

export function ImageStudio({ geminiConnected = false, cloudflareConnected = false }: { geminiConnected?: boolean; cloudflareConnected?: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GenImage[]>([]);
  const [engine, setEngine] = useState<Engine>(cloudflareConnected ? 'cloudflare' : 'pollinations');
  const [style, setStyle] = useState<'flux' | 'turbo'>('flux');
  const [mode, setMode] = useState<Mode>('create');
  const [pics, setPics] = useState<[Pic | null, Pic | null]>([null, null]);
  const [consent, setConsent] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function choosePicture(slot: 0 | 1, src: string) {
    try {
      const pic = await loadPicture(src);
      setPics((prev) => (slot === 0 ? [pic, prev[1]] : [prev[0], pic]));
      setError(null);
    } catch {
      setError("That file couldn't be read as a picture — try a JPEG, PNG or WebP.");
    }
  }

  function removePicture(slot: 0 | 1) {
    setPics((prev) => (slot === 0 ? [prev[1], null] : [prev[0], null]));
    setConsent(false);
  }

  /** "Edit this" on a result: it becomes the picture to edit. */
  function editResult(image: GenImage) {
    setMode('edit');
    setPics([null, null]);
    setConsent(false);
    void choosePicture(0, image.dataUrl);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    inputRef.current?.focus();
  }

  async function edit(text: string) {
    const clean = text.trim();
    const chosen = pics.filter((p): p is Pic => !!p);
    if (!clean || busy || chosen.length === 0) return;
    if (chosen.length > 1 && !consent) {
      setError('Tick the box to confirm you have permission to use these people’s pictures.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/images/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: clean, images: chosen.map((p) => p.dataUrl), width: chosen[0].width, height: chosen[0].height }),
      });
      const data = await res.json().catch(() => null);
      if (!data?.dataUrl) {
        setError(data?.error?.message ?? 'Something went wrong editing the picture.');
        return;
      }
      setImages((prev) => [{ id: crypto.randomUUID(), prompt: clean, dataUrl: data.dataUrl }, ...prev]);
      toast('Edit ready');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const submit = (text: string) => void (mode === 'edit' ? edit(text) : generate(text));

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

      // Cloudflare's daily allowance used up, or Cloudflare unreachable / failing — make it with Pollinations
      if (!result.dataUrl && engine === 'cloudflare' && (result.status === 429 || result.status === 0 || result.status >= 500)) {
        toast(result.status === 429 ? "Today's Cloudflare allowance is used up — made it with Pollinations instead" : 'Cloudflare failed — used Pollinations instead');
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
        subtitle="Describe a picture and FreeToken draws it with a free FLUX model — or upload a photo and say how to change it."
      />

      <form
        className="card card-pad flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(prompt);
        }}
      >
        <div className="inline-flex self-start overflow-hidden rounded-lg border border-[var(--border)] text-xs">
          {(['create', 'edit'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(null); }} data-active={mode === m}
              className="px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white">
              {m === 'create' ? 'Create' : 'Edit a photo'}
            </button>
          ))}
        </div>
        {mode === 'edit' && !cloudflareConnected && (
          <p role="note" className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
            Editing photos runs on your free Cloudflare allowance (about 80 edits a day).{' '}
            <a href="/connect" className="font-semibold underline">Connect Cloudflare</a> to use it — it&apos;s free, no card.
          </p>
        )}
        {mode === 'edit' && cloudflareConnected && (
          <>
            <div className="flex flex-wrap gap-3">
              {([0, 1] as const).map((slot) => {
                const pic = pics[slot];
                if (slot === 1 && !pics[0]) return null;
                return (
                  <div key={slot} className="flex flex-col gap-1">
                    <span className="muted text-xs">{slot === 0 ? 'Picture to edit' : 'Second picture (optional — face swap, add a person)'}</span>
                    {pic ? (
                      <div className="relative">
                        <img src={pic.dataUrl} alt={slot === 0 ? 'Picture to edit' : 'Second picture'} className="h-32 w-auto max-w-[12rem] rounded-xl border border-[var(--border)] object-cover" />
                        <button type="button" onClick={() => removePicture(slot)} disabled={busy} aria-label="Remove picture"
                          className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white">×</button>
                      </div>
                    ) : (
                      <label className="grid h-32 w-48 cursor-pointer place-items-center rounded-xl border border-dashed border-[var(--border)] text-xs muted transition hover:border-[var(--brand)]">
                        + Upload a picture
                        <input type="file" accept="image/*" className="sr-only" disabled={busy}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) await choosePicture(slot, await readFile(file));
                          }} />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {EDIT_PRESETS.map((p) => (
                <button key={p.label} type="button" disabled={busy || (p.two && !pics[1])}
                  title={p.two && !pics[1] ? 'Add a second picture first' : p.prompt}
                  onClick={() => { setPrompt(p.prompt); inputRef.current?.focus(); }}
                  className="btn btn-ghost btn-sm disabled:opacity-40">
                  {p.label}
                </button>
              ))}
            </div>
            {pics[1] && (
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
                <span>
                  These are pictures of me, or of people who agreed to this. I won&apos;t use the result to impersonate,
                  deceive or embarrass anyone.
                </span>
              </label>
            )}
          </>
        )}
        <textarea
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit(prompt);
            }
          }}
          rows={3}
          maxLength={2000}
          disabled={busy}
          placeholder={mode === 'edit' ? 'Say how to change it — "make it anime style", "put him in a suit"…' : 'A golden retriever puppy wearing tiny sunglasses, studio photo…'}
          className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)]"
        />
        {mode === 'create' && (geminiConnected || cloudflareConnected) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="muted">Engine</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)]">
              {cloudflareConnected && (
                <button
                  type="button"
                  onClick={() => setEngine('cloudflare')}
                  data-active={engine === 'cloudflare'}
                  title="FLUX.1 schnell on your Cloudflare account — free within 10,000 Neurons a day (about 170 images), reset 00:00 UTC"
                  className="px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white"
                >
                  Cloudflare FLUX (free daily)
                </button>
              )}
              <button
                type="button"
                onClick={() => setEngine('pollinations')}
                data-active={engine === 'pollinations'}
                className="px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white"
              >
                Pollinations FLUX (free)
              </button>
              {geminiConnected && <button
                type="button"
                onClick={() => setEngine('gemini')}
                data-active={engine === 'gemini'}
                title="Needs a paid Gemini key (billing on) — free keys get no image quota from Google"
                className="px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white"
              >
                Gemini (paid key)
              </button>}
            </div>
          </div>
        )}
        {mode === 'create' && geminiConnected && engine === 'gemini' && (
          <p role="note" className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-xs">
            Gemini images need a <b>paid</b> Gemini key: Google gives free keys no image quota (yours still works for chat).
            Turn on billing for it in Google AI Studio — or use <b>FLUX</b>, which is free with no key. With a free key, FreeToken makes the image with FLUX instead.
          </p>
        )}
        {mode === 'create' && engine === 'pollinations' && (
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
          <button type="submit" disabled={busy || !prompt.trim() || (mode === 'edit' && (!cloudflareConnected || !pics[0]))} className="btn btn-primary">
            {mode === 'edit' ? (busy ? 'Editing…' : 'Edit') : busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </form>

      {error && (
        <div className="card card-pad border-[var(--danger,#ef4444)] text-sm" style={{ color: 'var(--danger, #ef4444)' }}>
          {error}
        </div>
      )}

      {mode === 'create' && images.length === 0 && !busy && (
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
              <img src={img.dataUrl} alt={img.prompt} className="aspect-square w-full bg-[var(--surface-2)] object-contain" />
              <figcaption className="flex flex-col gap-2 p-3">
                <p className="line-clamp-2 text-xs" title={img.prompt}>{img.prompt}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => download(img)} className="btn btn-ghost btn-sm">
                    Download
                  </button>
                  {cloudflareConnected && (
                    <button type="button" onClick={() => editResult(img)} disabled={busy} className="btn btn-ghost btn-sm">
                      Edit this
                    </button>
                  )}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
