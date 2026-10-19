'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Voice {
  id: string;
  name: string;
  description?: string;
}

const SAMPLE = 'The quick brown fox jumps over the lazy dog — and it sounds completely natural.';

export function VoiceStudio({ service, serviceLabel }: { service: string | null; serviceLabel: string | null }) {
  const [text, setText] = useState('');
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState('');
  const [filter, setFilter] = useState('');
  const [loadingVoices, setLoadingVoices] = useState(Boolean(service));
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load the connected service's voice library once on mount (deferred to avoid a sync setState).
  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/audio/voices');
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (res.ok && Array.isArray(data?.voices)) {
          setVoices(data.voices);
          if (data.voices[0]) setVoiceId(data.voices[0].id);
        } else {
          setError(data?.error?.message ?? 'Could not load voices.');
        }
      } catch {
        if (!cancelled) setError('Could not load voices.');
      } finally {
        if (!cancelled) setLoadingVoices(false);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [service]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return voices;
    return voices.filter((v) => `${v.name} ${v.description ?? ''}`.toLowerCase().includes(q));
  }, [voices, filter]);

  // Keep the selection valid when the filter narrows the list.
  useEffect(() => {
    if (filtered.length && !filtered.some((v) => v.id === voiceId)) {
      const next = filtered[0].id;
      const t = setTimeout(() => setVoiceId(next), 0);
      return () => clearTimeout(t);
    }
  }, [filtered, voiceId]);

  async function generate() {
    const clean = text.trim();
    if (!clean || generating) return;
    setGenerating(true);
    setError(null);
    setAudioUrl(null);
    try {
      const res = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: clean.slice(0, 5000), voiceId: voiceId || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.dataUrl) {
        setError(data?.error?.message ?? 'Could not generate audio.');
        return;
      }
      setAudioUrl(data.dataUrl);
      // Autoplay the result once it's rendered.
      setTimeout(() => void audioRef.current?.play().catch(() => {}), 0);
    } catch {
      setError('Could not reach the speech service.');
    } finally {
      setGenerating(false);
    }
  }

  const selectedVoice = voices.find((v) => v.id === voiceId);

  return (
    <div className="relative">
      <div className="aurora" aria-hidden />
      <header className="grid-bg relative mb-8 pb-2">
        <span className="eyebrow">Voice studio</span>
        <h1 className="h1 mt-2">
          Type it. <span className="grad-text">Hear it spoken.</span>
        </h1>
        <p className="lead mt-3 max-w-2xl">
          Write a sentence, pick a voice from your connected text-to-speech library, and play or download it as audio.
        </p>
      </header>

      {!service ? (
        <div className="card card-pad max-w-2xl">
          <h2 className="h2">Connect a voice service first</h2>
          <p className="muted mt-2">
            Voice Studio reads your text with a real text-to-speech service. Connect{' '}
            <strong>ElevenLabs</strong> (dozens of library voices) or <strong>Google Cloud TTS</strong> on the
            Connect page — both have a free tier.
          </p>
          <Link href="/connect" className="btn btn-primary mt-4">Go to Connect</Link>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
          {/* Composer */}
          <div className="card card-pad flex flex-col gap-4">
            <textarea
              className="input min-h-[9rem] resize-y py-3 leading-relaxed"
              placeholder="Type a sentence to read aloud…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate(); }}
              maxLength={5000}
              style={{ height: 'auto' }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={generate}
                disabled={!text.trim() || generating}
                className="btn btn-primary"
              >
                {generating ? 'Generating…' : '🔊 Generate'}
              </button>
              <button
                type="button"
                onClick={() => setText(SAMPLE)}
                className="btn btn-ghost btn-sm"
              >
                Use a sample
              </button>
              <span className="faint ml-auto text-xs">
                {selectedVoice ? `Voice: ${selectedVoice.name}` : ''} · ⌘/Ctrl + Enter
              </span>
            </div>

            {error && <p className="badge badge-bad w-fit">{error}</p>}

            {audioUrl && (
              <div className="stat flex flex-col gap-3">
                <audio ref={audioRef} controls src={audioUrl} className="w-full" />
                <a
                  href={audioUrl}
                  download={`freetoken-${(selectedVoice?.name ?? 'voice').replace(/\s+/g, '-').toLowerCase()}.mp3`}
                  className="btn btn-secondary btn-sm w-fit"
                >
                  ⬇ Download .mp3
                </a>
              </div>
            )}
          </div>

          {/* Voice picker */}
          <aside className="card card-pad flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="h2 text-base">Voice</h2>
              <span className="badge badge-off">{serviceLabel}</span>
            </div>

            {loadingVoices ? (
              <p className="muted text-sm">Loading voices…</p>
            ) : voices.length === 0 ? (
              <p className="muted text-sm">No voices available on this account.</p>
            ) : (
              <>
                <input
                  className="input"
                  placeholder={`Filter ${voices.length} voices…`}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <div className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto pr-1">
                  {filtered.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVoiceId(v.id)}
                      data-active={v.id === voiceId}
                      className="cmd-item text-left"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{v.name}</span>
                        {v.description && <span className="faint truncate text-xs">{v.description}</span>}
                      </span>
                    </button>
                  ))}
                  {filtered.length === 0 && <p className="muted px-2 py-1 text-sm">No match.</p>}
                </div>
              </>
            )}
            <p className="faint mt-1 text-xs">
              Library voices only. Cloning a real person&apos;s voice isn&apos;t supported.
            </p>
          </aside>
        </div>
      )}
    </div>
  );
}
