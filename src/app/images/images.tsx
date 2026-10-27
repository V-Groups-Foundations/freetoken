'use client';

/* eslint-disable @next/next/no-img-element -- generated images are data URLs or private gallery files, not optimizable assets */

import { useEffect, useRef, useState } from 'react';
import { PageHeader } from '../page-header';
import { toast } from '../fx';
import { DrawPad } from './draw-pad';

interface GenImage {
  /** gallery id, or a local id for a picture that isn't saved (a comic strip put together here) */
  id: string;
  prompt: string;
  /** a data URL, or the gallery address /api/images/gallery/<id> */
  src: string;
  saved: boolean;
}

const SUGGESTIONS = [
  'a cozy reading nook by a rainy window, warm lamplight',
  'an astronaut relaxing on a tropical beach, retro poster',
  'a neon-lit ramen stall in a cyberpunk alley at night',
  'a watercolor fox curled asleep in autumn leaves',
];

function slug(prompt: string) {
  return prompt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
}

function download(image: GenImage) {
  const a = document.createElement('a');
  a.href = image.src;
  a.download = `freetoken-${slug(image.prompt)}.jpg`;
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

/** Loads a file, data URL or gallery picture, shrinks it to fit 1024px and re-encodes it as JPEG. */
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

/** Four panels side by side in a 2×2 grid, as one downloadable picture. */
async function composeStrip(panels: string[]): Promise<string> {
  const imgs = await Promise.all(panels.map((src) => new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  })));
  const cell = 512;
  const gap = 12;
  const canvas = document.createElement('canvas');
  canvas.width = cell * 2 + gap * 3;
  canvas.height = cell * 2 + gap * 3;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  imgs.forEach((img, i) => {
    const x = gap + (i % 2) * (cell + gap);
    const y = gap + Math.floor(i / 2) * (cell + gap);
    const s = Math.max(cell / img.naturalWidth, cell / img.naturalHeight); // cover the cell
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cell, cell);
    ctx.clip();
    ctx.drawImage(img, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    ctx.restore();
  });
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** One-click edits. `two` = needs the second picture (and the consent tick). */
const PRESET_GROUPS: { group: string; presets: { label: string; prompt: string; two?: boolean }[] }[] = [
  { group: 'Style', presets: [
    { label: 'Anime style', prompt: 'Turn this picture into an anime illustration. Keep the same person, pose and composition.' },
    { label: '3D cartoon', prompt: 'Turn this picture into a colorful 3D animated-movie style render. Keep the same person, expression and composition.' },
    { label: 'Watercolor', prompt: 'Repaint this picture as a soft watercolor painting. Keep the same subject and composition.' },
    { label: 'Pencil sketch', prompt: 'Turn this picture into a detailed black-and-white pencil sketch. Keep the same subject and composition.' },
  ] },
  { group: 'People', presets: [
    { label: 'Wear a suit', prompt: 'Dress the person in a sharp, well-fitted dark business suit with a white shirt and tie. Keep their face, pose and the background unchanged.' },
    { label: 'Pro headshot', prompt: 'Turn this into a professional corporate headshot: neat business attire, soft studio lighting, plain light-grey background. Keep the face exactly the same.' },
    { label: 'Fighting pose', prompt: 'Show the person in a dynamic martial-arts fighting stance, mid-action, with motion and energy. Keep their face, hair and clothing recognizable.' },
    { label: 'Beach background', prompt: 'Replace the background with a sunny tropical beach. Keep the person exactly as they are, with matching lighting.' },
  ] },
  { group: 'Products & rooms', presets: [
    { label: 'Studio product shot', prompt: 'Turn this into a professional product photo: the same product on a clean white studio background with soft shadows and even lighting. Keep the product exactly as it is.' },
    { label: 'Lifestyle product shot', prompt: 'Place this product in an attractive real-life setting that suits it, with natural light, like a magazine ad. Keep the product exactly as it is.' },
    { label: 'Redesign room', prompt: 'Redesign this room in a warm Scandinavian style: light wood, soft textiles and plants. Keep the room’s layout, walls and windows.' },
  ] },
  { group: 'Fix', presets: [
    { label: 'Restore old photo', prompt: 'Restore this old photo: remove scratches, dust and creases, fix the fading, sharpen details and add natural, realistic color. Keep every person and detail exactly the same.' },
  ] },
  { group: 'Two pictures', presets: [
    { label: 'Try on clothes', two: true, prompt: 'Dress the person in the first image in the clothing from the second image. Keep their face, hair, pose and the background unchanged.' },
    { label: 'Add to room', two: true, prompt: 'Place the furniture or object from the second image into the room in the first image, at a natural size and position, with matching lighting and shadows.' },
    { label: 'Face swap', two: true, prompt: "Replace the face of the person in the first image with the face of the person in the second image. Keep the first image's hair, pose, clothing, lighting and background." },
    { label: 'Put them together', two: true, prompt: 'Put the person from the second image next to the person in the first image, in the same scene and lighting, as if photographed together.' },
  ] },
];

const MARK_PROMPT = 'Replace the area painted in red with … . Remove all the red paint and change nothing else.';
const SKETCH_PROMPT = 'Turn this rough sketch into a detailed, realistic picture of the same thing, with the same composition.';

/** One selfie, eight looks. */
const AVATAR_STYLES = [
  ['Headshot', 'a professional corporate headshot with soft studio lighting and a plain light-grey background'],
  ['Anime', 'an anime illustration with clean line art and vibrant colors'],
  ['3D cartoon', 'a colorful 3D animated-movie character render'],
  ['Pixel art', 'detailed 16-bit pixel art'],
  ['Oil painting', 'a classical oil painting portrait with visible brushstrokes'],
  ['Watercolor', 'a soft watercolor portrait'],
  ['Comic book', 'a bold comic-book illustration with ink outlines and halftone shading'],
  ['Neon cyberpunk', 'a neon-lit cyberpunk portrait at night'],
].map(([label, style]) => ({ label, prompt: `Turn this into ${style}. Keep the same person: face, hair and expression clearly recognizable. Head-and-shoulders portrait.` }));

const COMIC_BEATS = ['the opening scene that introduces the character', 'the problem or surprise', 'the big action moment', 'the happy ending'];
const comicPrompt = (story: string, n: number) =>
  `Comic book panel ${n + 1} of 4 — ${COMIC_BEATS[n]} — for this story: ${story}. The main character is the one in the image: keep their face, hair and outfit identical. Bold ink outlines, flat bright colors, dynamic framing, no speech bubbles or text.`;

const VARIATION_PROMPT = 'Make a variation of this picture: the same subject, style and composition, with small natural differences in details, pose and lighting.';

export function ImageStudio({ geminiConnected = false, cloudflareConnected = false }: { geminiConnected?: boolean; cloudflareConnected?: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<GenImage[]>([]);
  const [engine, setEngine] = useState<Engine>(cloudflareConnected ? 'cloudflare' : 'pollinations');
  const [style, setStyle] = useState<'flux' | 'turbo'>('flux');
  const [mode, setMode] = useState<Mode>('create');
  const [pics, setPics] = useState<[Pic | null, Pic | null]>([null, null]);
  const [consent, setConsent] = useState(false);
  const [pad, setPad] = useState<'sketch' | 'mark' | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // the saved gallery: everything made here, in edits, or by V-Run through /v1/images
  useEffect(() => {
    fetch('/api/images/gallery')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { images?: { id: string; prompt: string }[] } | null) => {
        if (!j?.images) return;
        setImages((prev) => [...prev, ...j.images!.filter((g) => !prev.some((p) => p.id === g.id))
          .map((g) => ({ id: g.id, prompt: g.prompt, src: `/api/images/gallery/${g.id}`, saved: true }))]);
      })
      .catch(() => {});
  }, []);

  const add = (img: GenImage) => setImages((prev) => [img, ...prev]);
  const fromResponse = (prompt: string, data: { dataUrl: string; id?: string | null }): GenImage =>
    ({ id: data.id ?? crypto.randomUUID(), prompt, src: data.dataUrl, saved: !!data.id });

  async function callEngine(prompt: string, which: Engine): Promise<{ data?: { dataUrl: string; id?: string | null }; status: number; message?: string }> {
    const res = await fetch('/api/images', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, engine: which, model: which === 'pollinations' ? style : undefined }),
    });
    const data = await res.json().catch(() => null);
    return { data: data?.dataUrl ? data : undefined, status: res.status, message: data?.error?.message };
  }

  /** One edit through Cloudflare; the error message when it fails, with whether to stop a batch. */
  async function callEdit(text: string, chosen: Pic[]): Promise<{ image?: GenImage; message?: string; stop?: boolean }> {
    const res = await fetch('/api/images/edit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: text, images: chosen.map((p) => p.dataUrl), width: chosen[0].width, height: chosen[0].height }),
    });
    const data = await res.json().catch(() => null);
    if (data?.dataUrl) return { image: fromResponse(text, data) };
    // the day's allowance or a key problem won't fix itself on the next picture
    return { message: data?.error?.message ?? 'Something went wrong editing the picture.', stop: res.status === 429 || res.status === 401 || res.status === 403 || res.status === 400 };
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
      if (!result.data && engine === 'gemini' && (result.status === 429 || result.status === 402)) {
        toast(result.status === 402 ? 'Gemini images need a paid key — made it with FLUX (free) instead' : 'Gemini was rate-limited — used FLUX instead');
        result = await callEngine(clean, 'pollinations');
      }

      // Cloudflare's daily allowance used up, or Cloudflare unreachable / failing — make it with Pollinations
      if (!result.data && engine === 'cloudflare' && (result.status === 429 || result.status === 0 || result.status >= 500)) {
        toast(result.status === 429 ? "Today's Cloudflare allowance is used up — made it with Pollinations instead" : 'Cloudflare failed — used Pollinations instead');
        result = await callEngine(clean, 'pollinations');
      }

      if (!result.data) {
        setError(result.message ?? 'Something went wrong generating the image.');
        return;
      }
      add(fromResponse(clean, result.data));
      setPrompt('');
      toast('Image ready');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function chosenPics(): Pic[] | null {
    const chosen = pics.filter((p): p is Pic => !!p);
    if (chosen.length === 0) return null;
    if (chosen.length > 1 && !consent) {
      setError('Tick the box to confirm you have permission to use these people’s pictures.');
      return null;
    }
    return chosen;
  }

  async function edit(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    if (clean.includes('…')) {
      setError('Fill in the “…” in the instruction first — say what should go there.');
      return;
    }
    const chosen = chosenPics();
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const r = await callEdit(clean, chosen);
      if (!r.image) {
        setError(r.message ?? 'Something went wrong editing the picture.');
        return;
      }
      add(r.image);
      toast('Edit ready');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  /** Several edits one after another (avatar pack, comic strip, variations); keeps going past a failed one. */
  async function batch(label: string, jobs: { prompt: string; pics: Pic[] }[]): Promise<GenImage[]> {
    if (busy) return [];
    setBusy(true);
    setError(null);
    const made: GenImage[] = [];
    let lastError: string | undefined;
    try {
      for (let i = 0; i < jobs.length; i++) {
        setProgress({ label, done: i, total: jobs.length });
        const r = await callEdit(jobs[i].prompt, jobs[i].pics);
        if (r.image) { made.push(r.image); add(r.image); continue; }
        lastError = r.message;
        if (r.stop) break;
      }
      if (lastError) setError(`${made.length} of ${jobs.length} made. ${lastError}`);
      else toast(`${label}: ${made.length} pictures ready`);
    } catch {
      setError(`${made.length} of ${jobs.length} made. Could not reach the server — check your connection.`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
    return made;
  }

  async function avatarPack() {
    const pic = pics[0];
    if (!pic) return;
    await batch('Avatar pack', AVATAR_STYLES.map((s) => ({ prompt: s.prompt, pics: [pic] })));
  }

  async function comicStrip() {
    const pic = pics[0];
    const story = prompt.trim();
    if (!pic) return;
    if (!story || story.includes('…')) {
      setError('Write the story in the box first — one or two sentences, e.g. “saves a kitten from a tree and becomes the town hero”.');
      return;
    }
    const panels = await batch('Comic strip', [0, 1, 2, 3].map((n) => ({ prompt: comicPrompt(story, n), pics: [pic] })));
    if (panels.length === 4) {
      const strip = await composeStrip(panels.map((p) => p.src)).catch(() => null);
      if (strip) add({ id: crypto.randomUUID(), prompt: `Comic strip: ${story}`, src: strip, saved: false });
    }
  }

  async function variations(image: GenImage) {
    if (cloudflareConnected) {
      const pic = await loadPicture(image.src).catch(() => null);
      if (!pic) return setError("That picture couldn't be loaded.");
      await batch('Variations', [0, 1, 2].map(() => ({ prompt: VARIATION_PROMPT, pics: [pic] })));
      return;
    }
    // without Cloudflare: the same prompt again, three times (each run comes out different)
    for (let i = 0; i < 3; i++) await generate(image.prompt);
  }

  async function remove(image: GenImage) {
    if (image.saved) {
      const res = await fetch(`/api/images/gallery/${image.id}`, { method: 'DELETE' }).catch(() => null);
      if (!res?.ok) return setError("Couldn't delete that picture — try again.");
    }
    setImages((prev) => prev.filter((p) => p.id !== image.id));
  }

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
    setPad(null);
    void choosePicture(0, image.src);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    inputRef.current?.focus();
  }

  const submit = (text: string) => void (mode === 'edit' ? edit(text) : generate(text));
  const btn = 'px-3 py-1.5 font-semibold text-[var(--muted)] transition data-[active=true]:bg-[var(--brand)] data-[active=true]:text-white';

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
            <button key={m} type="button" onClick={() => { setMode(m); setError(null); }} data-active={mode === m} className={btn}>
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
        {mode === 'edit' && cloudflareConnected && pad && (
          <DrawPad
            key={pad}
            background={pad === 'mark' ? pics[0]?.dataUrl : undefined}
            colors={pad === 'mark' ? ['#ff0000'] : ['#111111', '#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#ffffff']}
            title={pad === 'mark' ? 'Paint over the part to change' : 'Draw a rough sketch'}
            hint={pad === 'mark' ? 'Cover it fully in red, then say what should go there.' : 'Stick figures and blobs are fine — FLUX turns it into a finished picture.'}
            onCancel={() => setPad(null)}
            onDone={(pic) => {
              setPics((prev) => [pic, pad === 'mark' ? prev[1] : null]);
              setPrompt(pad === 'mark' ? MARK_PROMPT : SKETCH_PROMPT);
              setPad(null);
              inputRef.current?.focus();
            }}
          />
        )}
        {mode === 'edit' && cloudflareConnected && !pad && (
          <>
            <div className="flex flex-wrap gap-3">
              {([0, 1] as const).map((slot) => {
                const pic = pics[slot];
                if (slot === 1 && !pics[0]) return null;
                return (
                  <div key={slot} className="flex flex-col gap-1">
                    <span className="muted text-xs">{slot === 0 ? 'Picture to edit' : 'Second picture (optional — try-on, face swap, add a person or object)'}</span>
                    {pic ? (
                      <div className="relative self-start">
                        <img src={pic.dataUrl} alt={slot === 0 ? 'Picture to edit' : 'Second picture'} className="h-32 w-auto max-w-[12rem] rounded-xl border border-[var(--border)] object-cover" />
                        <button type="button" onClick={() => removePicture(slot)} disabled={busy} aria-label="Remove picture"
                          className="absolute right-1 top-1 rounded-full bg-black/60 px-2 text-xs text-white">×</button>
                      </div>
                    ) : (
                      <label className="muted grid h-32 w-48 cursor-pointer place-items-center rounded-xl border border-dashed border-[var(--border)] text-xs transition hover:border-[var(--brand)]">
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
              {!pics[0] && (
                <button type="button" onClick={() => setPad('sketch')} disabled={busy}
                  className="muted grid h-32 w-48 place-items-center self-end rounded-xl border border-dashed border-[var(--border)] text-xs transition hover:border-[var(--brand)]">
                  ✏️ Or draw a sketch
                </button>
              )}
            </div>
            {pics[0] && (
              <div className="flex flex-col gap-2">
                {PRESET_GROUPS.map((g) => (
                  <div key={g.group} className="flex flex-wrap items-center gap-2">
                    <span className="muted w-28 shrink-0 text-xs">{g.group}</span>
                    {g.presets.map((p) => (
                      <button key={p.label} type="button" disabled={busy || (p.two && !pics[1])}
                        title={p.two && !pics[1] ? 'Add a second picture first' : p.prompt}
                        onClick={() => { setPrompt(p.prompt); inputRef.current?.focus(); }}
                        className="btn btn-ghost btn-sm disabled:opacity-40">
                        {p.label}
                      </button>
                    ))}
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="muted w-28 shrink-0 text-xs">More</span>
                  <button type="button" disabled={busy} onClick={() => setPad('mark')} className="btn btn-ghost btn-sm" title="Paint over part of the picture, then say what goes there">
                    🖌️ Change a marked area
                  </button>
                  <button type="button" disabled={busy} onClick={() => void avatarPack()} className="btn btn-ghost btn-sm" title="8 styles of the same person, one after another (8 edits)">
                    Avatar pack · 8 styles
                  </button>
                  <button type="button" disabled={busy} onClick={() => void comicStrip()} className="btn btn-ghost btn-sm" title="Write a short story in the box; 4 panels with this character (4 edits)">
                    Comic strip · 4 panels
                  </button>
                </div>
              </div>
            )}
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
        {!pad && (
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
            placeholder={mode === 'edit' ? 'Say how to change it — "make it anime style", "put him in a suit"… (for a comic strip: the story)' : 'A golden retriever puppy wearing tiny sunglasses, studio photo…'}
            className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)]"
          />
        )}
        {mode === 'create' && (geminiConnected || cloudflareConnected) && (
          <div className="flex items-center gap-2 text-xs">
            <span className="muted">Engine</span>
            <div className="inline-flex overflow-hidden rounded-lg border border-[var(--border)]">
              {cloudflareConnected && (
                <button type="button" onClick={() => setEngine('cloudflare')} data-active={engine === 'cloudflare'} className={btn}
                  title="FLUX.1 schnell on your Cloudflare account — free within 10,000 Neurons a day (about 170 images), reset 00:00 UTC">
                  Cloudflare FLUX (free daily)
                </button>
              )}
              <button type="button" onClick={() => setEngine('pollinations')} data-active={engine === 'pollinations'} className={btn}>
                Pollinations FLUX (free)
              </button>
              {geminiConnected && (
                <button type="button" onClick={() => setEngine('gemini')} data-active={engine === 'gemini'} className={btn}
                  title="Needs a paid Gemini key (billing on) — free keys get no image quota from Google">
                  Gemini (paid key)
                </button>
              )}
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
              <button type="button" onClick={() => setStyle('flux')} data-active={style === 'flux'} className={btn}>Flux · best</button>
              <button type="button" onClick={() => setStyle('turbo')} data-active={style === 'turbo'} className={btn}>Turbo · fast</button>
            </div>
          </div>
        )}
        {!pad && (
          <div className="flex items-center justify-between gap-3">
            <span className="muted text-xs">⌘/Ctrl + Enter to {mode === 'edit' ? 'edit' : 'generate'}</span>
            <button type="submit" disabled={busy || !prompt.trim() || (mode === 'edit' && (!cloudflareConnected || !pics[0]))} className="btn btn-primary">
              {mode === 'edit' ? (busy ? 'Editing…' : 'Edit') : busy ? 'Generating…' : 'Generate'}
            </button>
          </div>
        )}
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
          <div className="ft-caret muted text-sm">
            {progress ? `${progress.label}: painting ${progress.done + 1} of ${progress.total}…` : 'painting your image…'}
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">Your pictures <span className="muted font-normal">· saved on this computer</span></h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((img) => (
              <figure key={img.id} className="card overflow-hidden">
                <img src={img.src} alt={img.prompt} loading="lazy" className="aspect-square w-full bg-[var(--surface-2)] object-contain" />
                <figcaption className="flex flex-col gap-2 p-3">
                  <p className="line-clamp-2 text-xs" title={img.prompt}>{img.prompt}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => download(img)} className="btn btn-ghost btn-sm">Download</button>
                    {cloudflareConnected && (
                      <button type="button" onClick={() => editResult(img)} disabled={busy} className="btn btn-ghost btn-sm">Edit this</button>
                    )}
                    <button type="button" onClick={() => void variations(img)} disabled={busy} className="btn btn-ghost btn-sm" title="3 more takes on this picture">
                      Variations
                    </button>
                    <button type="button" onClick={() => void remove(img)} disabled={busy} className="btn btn-ghost btn-sm" aria-label="Delete picture">
                      Delete
                    </button>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
