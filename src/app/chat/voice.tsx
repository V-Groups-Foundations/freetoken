'use client';

import { useEffect, useRef, useState } from 'react';

/** Record from the microphone and transcribe via /api/audio/transcribe (Groq Whisper). */
export function MicButton({ disabled, onText }: { disabled?: boolean; onText: (text: string) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'working'>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void transcribe(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }));
      };
      recorderRef.current = rec;
      rec.start();
      setState('recording');
    } catch {
      setState('idle');
    }
  }

  function stop() {
    recorderRef.current?.stop();
    setState('working');
  }

  async function transcribe(blob: Blob) {
    try {
      const form = new FormData();
      form.append('file', blob, 'recording.webm');
      const res = await fetch('/api/audio/transcribe', { method: 'POST', body: form });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.text) onText(String(data.text).trim());
    } finally {
      setState('idle');
    }
  }

  const label = state === 'recording' ? 'Stop recording' : 'Record voice';
  return (
    <button
      type="button"
      onClick={() => (state === 'recording' ? stop() : start())}
      disabled={disabled || state === 'working'}
      className={`btn shrink-0 px-2.5 text-base ${state === 'recording' ? 'btn-primary' : 'btn-ghost'}`}
      title={label}
      aria-label={label}
    >
      {state === 'working' ? '…' : state === 'recording' ? '⏹' : '🎤'}
    </button>
  );
}

// Minimal typings for the Web Speech API (not in the standard TS lib).
interface SRAlternative { transcript: string }
interface SRResult { 0: SRAlternative; isFinal: boolean }
interface SRResultList { length: number; [index: number]: SRResult }
interface SREvent { resultIndex: number; results: SRResultList }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Live dictation using the browser's built-in SpeechRecognition — keyless, instant, zero setup.
 * Renders only when the browser supports it (Chrome/Edge). Each final phrase is appended via onText.
 */
export function DictateButton({ disabled, onText }: { disabled?: boolean; onText: (text: string) => void }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Feature-detect after mount (deferred so it isn't a sync setState in the effect body).
  useEffect(() => {
    const t = setTimeout(() => setSupported(getRecognitionCtor() !== null), 0);
    return () => clearTimeout(t);
  }, []);

  function stop() {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  }

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const phrase = r[0].transcript.trim();
          if (phrase) onText(phrase);
        }
      }
    };
    rec.onerror = () => stop();
    rec.onend = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  if (!supported) return null;

  const label = listening ? 'Stop dictation' : 'Live dictation';
  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      disabled={disabled}
      className={`btn shrink-0 px-2.5 text-base ${listening ? 'btn-primary' : 'btn-ghost'}`}
      title={label}
      aria-label={label}
    >
      {listening ? '⏺' : '🗣️'}
    </button>
  );
}

// Remembered across buttons for the session: once we learn no premium TTS is connected,
// skip the server round-trip and go straight to the browser voice.
let serverTtsAvailable: boolean | null = null;

/**
 * Read text aloud. Prefers a connected premium voice (ElevenLabs / Google Cloud TTS) via
 * /api/audio/tts, and falls back to the browser's built-in speechSynthesis — free, no key.
 */
export function SpeakButton({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function stopAll() {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function browserSpeak() {
    if (typeof window === 'undefined' || !window.speechSynthesis) { setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(text.slice(0, 32000));
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  async function serverSpeak(): Promise<boolean> {
    try {
      const res = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 5000) }),
      });
      if (!res.ok) {
        if (res.status === 400) {
          const data = await res.json().catch(() => ({}));
          if (data?.error?.code === 'no_tts') serverTtsAvailable = false;
        }
        return false;
      }
      const data = await res.json().catch(() => null);
      if (!data?.dataUrl) return false;
      serverTtsAvailable = true;
      const audio = new Audio(data.dataUrl);
      audioRef.current = audio;
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => { setSpeaking(false); };
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  async function speak() {
    setSpeaking(true);
    if (serverTtsAvailable !== false) {
      const played = await serverSpeak();
      if (played) return;
    }
    browserSpeak();
  }

  function toggle() {
    if (speaking) { stopAll(); return; }
    void speak();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!text.trim()}
      className="faint text-xs hover:text-[var(--brand)]"
      title="Read aloud"
      aria-label="Read aloud"
    >
      {speaking ? '⏸ Stop' : '🔊 Listen'}
    </button>
  );
}
