'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Markdown } from '../chat/markdown';
import { MEALS, cleanReply, parseDietBlocks, stripDietBlocks, type DietAction } from '@/diet/protocol';
import { targetsMismatch, type Advice } from '@/diet/advisor';
import { Progress, type FullProfile, type Photo } from './progress';
import { Training } from './training';

type Entry = { id: number; meal: string; name: string; kcal: number; protein: number; fat: number; carbs: number };
type Profile = FullProfile;
type Msg = { role: 'user' | 'assistant'; content: string; provider?: string | null; photos?: string[] };

/**
 * A phone photo made small enough to send (longest side 1600 px, JPEG): a 12 MP camera shot is 3–5 MB,
 * over FreeToken's 4 MB image limit, and a label stays readable at this size.
 */
async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(/\.hei[cf]$/i.test(file.name) ? `This browser can't open HEIC photos (${file.name}) — choose it from the Photos app on your phone, or save it as JPEG first.` : `Couldn't read ${file.name} as a picture.`);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
type State = {
  day: string; profile: Profile; entries: Entry[];
  totals: { kcal: number; protein: number; fat: number; carbs: number };
  week: { day: string; kcal: number; protein: number }[];
  weights: { day: string; kg: number }[];
  advice: Advice;
  photos: Photo[];
  messages: Msg[];
  checkinDue?: boolean;
};

/** The user's own calendar day (their time zone), as YYYY-MM-DD. */
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return localDay(d); };
const r = (n: number) => Math.round(n);
const MEAL_ICON: Record<string, string> = { breakfast: '🌅', lunch: '🍱', dinner: '🍽️', snack: '🍎', drink: '🥤' };

const STARTERS = [
  "I'm 23, male, 186 cm, 95 kg, I lift 4× a week — I want to cut to 85 kg. What should my targets be?",
  'Breakfast: 30 g SAVAS whey (coffee) with water',
  'Plan the rest of my day to hit my targets',
  'Review my last week — what should I change?',
];

export function Diet() {
  const [today] = useState(localDay);
  const [day, setDay] = useState(today);
  const [s, setS] = useState<State | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the last message the coach didn't answer, for the Retry button
  const [unanswered, setUnanswered] = useState<{ text: string; photos: string[] } | null>(null);
  const [tab, setTab] = useState<'coach' | 'progress' | 'training'>('coach');
  const [checkinBusy, setCheckinBusy] = useState(false);

  const load = useCallback(async (d: string) => {
    const res = await fetch(`/api/diet?day=${d}&today=${today}`);
    if (!res.ok) return null;
    const j = (await res.json()) as State;
    setS(j);
    return j;
  }, [today]);
  // the day's tracker whenever the day changes; the conversation only with the first load
  const firstLoad = useRef(true);
  useEffect(() => {
    let live = true;
    fetch(`/api/diet?day=${day}&today=${today}`).then((res) => (res.ok ? res.json() : null)).then((j: State | null) => {
      if (!live || !j) return;
      setS(j);
      if (firstLoad.current) {
        firstLoad.current = false;
        setMsgs(j.messages);
        // a week since the last check-in: the coach writes this week's review into the conversation
        if (j.checkinDue) {
          setCheckinBusy(true);
          fetch('/api/diet/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ today }) })
            .then((r) => r.json()).then((c: { text?: string }) => { if (live && c.text) setMsgs((m) => [...m, { role: 'assistant', content: c.text! }]); })
            .catch(() => {}).finally(() => setCheckinBusy(false));
        }
      }
    }).catch(() => {});
    return () => { live = false; };
  }, [day, today]);

  async function send(content: string, photos: string[] = []) {
    const text = content.trim();
    if ((!text && !photos.length) || busy) return;
    setBusy(true); setError(null); setUnanswered(null);
    const base = [...msgs, { role: 'user' as const, content: text, photos }];
    setMsgs([...base, { role: 'assistant', content: '' }]);
    // a photo goes as an image part (with the words, if any) for a model that can see
    const body = photos.length ? [...(text ? [{ type: 'text', text }] : []), ...photos.map((url) => ({ type: 'image_url', image_url: { url } }))] : text;
    try {
      const res = await fetch('/api/diet/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: body, day: today }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => null); throw new Error(j?.error?.message ?? `Request failed (${res.status})`); }
      const prov = res.headers.get('x-freetoken-provider');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', out = '';
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
            if (typeof delta === 'string') { out += delta; setMsgs([...base, { role: 'assistant', content: out, provider: prov }]); }
          } catch { /* keep-alive */ }
        }
      }
      if (!cleanReply(out).trim()) {
        // the model sent no answer (busy, or it only "thought"): the server takes the question back out
        setMsgs(msgs);
        setUnanswered({ text, photos });
        throw new Error("The coach didn't answer — the AI service was busy. Tap Retry.");
      }
      // the server records the log just after the stream ends: wait for its copy of the reply (which shows
      // what was really recorded, not what the model sent), then show that
      setDay(today);
      for (let i = 0; i < 8; i++) {
        await new Promise((ok) => setTimeout(ok, 350));
        const j = await load(today);
        if (j && j.messages.length >= base.length + 1 && j.messages.at(-1)?.role === 'assistant') {
          // the server keeps "📷 photo" in place of the picture; this session still shows the picture itself
          const mine = j.messages.length - 2;
          setMsgs(j.messages.map((m, k) => (k === mine && photos.length ? { ...m, photos } : m)));
          break;
        }
      }
    } catch (e) {
      setMsgs(msgs);
      if (!(e instanceof Error && e.message.startsWith("The coach didn't answer"))) setUnanswered(null);
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function removeEntry(id: number) {
    await fetch(`/api/diet/entries/${id}`, { method: 'DELETE' });
    void load(day);
  }

  async function runCheckin() {
    setCheckinBusy(true); setError(null);
    try {
      const res = await fetch('/api/diet/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ today, force: true }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.text) throw new Error(j?.error ?? 'The check-in failed — try again.');
      setMsgs((m) => [...m, { role: 'assistant', content: j.text }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'The check-in failed.'); } finally { setCheckinBusy(false); }
  }

  async function newConversation() {
    await fetch('/api/diet', { method: 'DELETE' });
    setMsgs([]);
  }

  const tabs = (
    <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1" role="tablist" aria-label="Diet">
      {([['coach', '💬 Coach'], ['progress', '📈 Progress'], ['training', '🏋️ Training']] as const).map(([k, label]) => (
        <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
          className={`rounded-lg px-3 py-1.5 text-sm sm:px-4 ${tab === k ? 'bg-[var(--surface-2)] font-semibold text-[var(--ink)]' : 'muted'}`}>{label}</button>
      ))}
    </div>
  );

  if (tab === 'training') return (
    <div className="space-y-4">
      {tabs}
      <div className="mx-auto max-w-2xl"><Training today={today} onAsk={(text) => { setTab('coach'); void send(text); }} /></div>
    </div>
  );

  if (tab === 'progress') return (
    <div className="space-y-4">
      {tabs}
      {s ? <div className="mx-auto max-w-2xl"><Progress profile={s.profile} advice={s.advice} weights={s.weights} photos={s.photos} today={today} onChanged={() => load(day)} /></div>
        : <div className="card card-pad muted text-sm">Loading…</div>}
    </div>
  );

  return (
    <div className="space-y-4">
    {tabs}
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* phones: the chat comes first (with a one-line summary), the full tracker under it — above it, the
          day's whole log had to be scrolled past to reach the message box */}
      <div className="min-w-0 space-y-3">
        {s && <Summary s={s} />}
        <CoachChat msgs={msgs} busy={busy || checkinBusy} error={error} onSend={send} onRetry={unanswered ? () => send(unanswered.text, unanswered.photos) : undefined} onNew={newConversation} onCheckin={runCheckin} checkinBusy={checkinBusy} />
      </div>
      <div className="min-w-0">
        {s ? <Tracker s={s} day={day} today={today} setDay={setDay} onRemove={removeEntry} onSaved={() => load(day)} /> : <div className="card card-pad muted text-sm">Loading…</div>}
      </div>
    </div>
    </div>
  );
}

/* ---------------------------------------------------------------- tracker */

/** Phones only: today's numbers in one line above the chat. */
function Summary({ s }: { s: State }) {
  const p = s.profile, t = s.totals;
  const left = (target: number | null | undefined, v: number) => (target ? r(target - v) : null);
  const kcal = left(p?.calories, t.kcal);
  return (
    // hidden on the wrapper: .card sets its own display, which beat lg:hidden on the card itself
    <div className="lg:hidden">
      <div className="card flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <div><b className="tabular-nums">{kcal ?? r(t.kcal)}</b> <span className="muted">kcal {kcal == null ? 'eaten' : kcal < 0 ? 'over' : 'left'}</span></div>
        <div className="muted flex gap-3 text-xs tabular-nums">
          <span>P {left(p?.protein, t.protein) ?? r(t.protein)}</span><span>F {left(p?.fat, t.fat) ?? r(t.fat)}</span><span>C {left(p?.carbs, t.carbs) ?? r(t.carbs)}</span>
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, target, unit, color }: { label: string; value: number; target: number | null; unit: string; color: string }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = target != null && value > target;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">
          <b>{r(value)}</b>{target ? <span className="faint"> / {target} {unit}</span> : <span className="faint"> {unit}</span>}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: over ? 'var(--danger)' : color }} />
      </div>
      {target != null && <div className={`mt-0.5 text-xs ${over ? 'text-[var(--danger)]' : 'faint'}`}>{over ? `${r(value - target)} ${unit} over` : `${r(target - value)} ${unit} left`}</div>}
    </div>
  );
}

function Tracker({ s, day, today, setDay, onRemove, onSaved }: { s: State; day: string; today: string; setDay: (d: string) => void; onRemove: (id: number) => void; onSaved: () => void }) {
  const p = s.profile;
  const [editing, setEditing] = useState(false);
  const label = day === today ? 'Today' : day === shift(today, -1) ? 'Yesterday' : new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const byMeal = MEALS.map((m) => [m, s.entries.filter((e) => e.meal === m)] as const).filter(([, list]) => list.length);
  const last = s.weights.at(-1), first = s.weights[0];
  const maxKcal = Math.max(p?.calories ?? 0, ...s.week.map((d) => d.kcal), 1);
  const days = Array.from({ length: 7 }, (_, i) => shift(day, i - 6));

  return (
    <div className="card card-pad space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={() => setDay(shift(day, -1))} className="btn btn-ghost btn-sm" aria-label="Previous day">‹</button>
        <div className="text-center">
          <div className="font-semibold">{label}</div>
          <div className="faint text-xs">{day}</div>
        </div>
        <button onClick={() => setDay(shift(day, 1))} disabled={day >= today} className="btn btn-ghost btn-sm disabled:opacity-30" aria-label="Next day">›</button>
      </div>

      <div className="text-center">
        {p?.calories ? (
          <>
            <div className={`display text-4xl font-bold tabular-nums ${s.totals.kcal > p.calories ? 'text-[var(--danger)]' : ''}`}>{r(Math.abs(p.calories - s.totals.kcal))}</div>
            <div className="muted text-sm">kcal {s.totals.kcal > p.calories ? 'over' : 'left'} · {r(s.totals.kcal)} of {p.calories} eaten</div>
          </>
        ) : (
          <>
            <div className="display text-4xl font-bold tabular-nums">{r(s.totals.kcal)}</div>
            <div className="muted text-sm">kcal eaten · <button onClick={() => setEditing(true)} className="underline">set a target</button></div>
          </>
        )}
      </div>

      <div className="space-y-3">
        <Bar label="Protein" value={s.totals.protein} target={p?.protein ?? null} unit="g" color="#38d6ff" />
        <Bar label="Fat" value={s.totals.fat} target={p?.fat ?? null} unit="g" color="#f5b544" />
        <Bar label="Carbs" value={s.totals.carbs} target={p?.carbs ?? null} unit="g" color="#8b7cf6" />
      </div>

      <div>
        <div className="eyebrow mb-2">Eaten</div>
        {byMeal.length === 0 ? <p className="faint text-sm">Nothing logged{day === today ? ' yet — tell the coach what you had.' : '.'}</p> : (
          <div className="space-y-3">
            {byMeal.map(([meal, list]) => (
              <div key={meal}>
                <div className="mb-1 flex justify-between text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                  <span>{MEAL_ICON[meal]} {meal}</span><span className="tabular-nums">{r(list.reduce((a, e) => a + e.kcal, 0))} kcal</span>
                </div>
                <ul className="divide-y divide-[var(--border)]">
                  {list.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 py-1.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate" title={e.name}>{e.name}</div>
                        <div className="faint text-xs tabular-nums">P {r(e.protein)} · F {r(e.fat)} · C {r(e.carbs)}</div>
                      </div>
                      <span className="tabular-nums">{r(e.kcal)}</span>
                      <button onClick={() => onRemove(e.id)} className="faint -my-1 px-2 py-1 hover:text-[var(--danger)]" aria-label={`Remove ${e.name}`} title="Remove">×</button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="eyebrow mb-2">7 days</div>
        <div className="flex h-24 items-end gap-1.5" role="img" aria-label="Calories per day for the last 7 days">
          {days.map((d) => {
            const k = s.week.find((w) => w.day === d)?.kcal ?? 0;
            const over = p?.calories && k > p.calories;
            return (
              <button key={d} onClick={() => setDay(d)} className="group flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d}: ${r(k)} kcal`}>
                <div className="w-full rounded-t-md transition-[height] duration-500" style={{ height: `${Math.max(k ? 6 : 2, (k / maxKcal) * 100)}%`, background: k ? (over ? 'var(--danger)' : d === day ? 'var(--brand)' : 'color-mix(in srgb, var(--brand) 45%, transparent)') : 'var(--surface-2)' }} />
                <span className={`text-[10px] ${d === day ? 'font-semibold text-[var(--ink)]' : 'faint'}`}>{new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="muted">Weight</span>
        <span className="tabular-nums">
          {last ? <><b>{last.kg} kg</b>{first && first.day !== last.day && <span className={last.kg <= first.kg ? ' text-[var(--success,#3ccf91)]' : ' text-[var(--danger)]'}> {last.kg - first.kg > 0 ? '+' : ''}{(last.kg - first.kg).toFixed(1)} since {first.day.slice(5)}</span>}
            <button onClick={async () => { await fetch(`/api/diet/weights?day=${last.day}`, { method: 'DELETE' }); onSaved(); }} className="faint -my-1 ml-1 px-1.5 py-1 hover:text-[var(--danger)]" aria-label={`Remove the ${last.day} weigh-in`} title={`Remove the ${last.day} weigh-in`}>×</button></> : <span className="faint">tell the coach your weight</span>}
        </span>
      </div>

      {editing ? <TargetsForm p={p} onDone={() => { setEditing(false); onSaved(); }} /> : (
        <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm w-full">{p?.calories ? 'Edit targets' : 'Set targets'}</button>
      )}
    </div>
  );
}

function TargetsForm({ p, onDone }: { p: Profile; onDone: () => void }) {
  const [v, setV] = useState({ calories: p?.calories ?? '', protein: p?.protein ?? '', fat: p?.fat ?? '', carbs: p?.carbs ?? '' });
  const [saving, setSaving] = useState(false);
  const field = (k: keyof typeof v, label: string, unit: string) => (
    <label className="text-xs">
      <span className="muted">{label}</span>
      <div className="mt-1 flex items-center gap-1">
        <input inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d]/g, '') })} className="input w-full text-[16px] sm:text-sm" />
        <span className="faint">{unit}</span>
      </div>
    </label>
  );
  const num = (x: string | number) => (x === '' ? null : Number(x));
  // protein and carbs 4 kcal/g, fat 9: say so when the macros and the calories disagree, and offer a fix
  const off = targetsMismatch({ calories: num(v.calories), protein: num(v.protein), fat: num(v.fat), carbs: num(v.carbs) });
  async function save() {
    setSaving(true);
    await fetch('/api/diet/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calories: num(v.calories), protein: num(v.protein), fat: num(v.fat), carbs: num(v.carbs) }) });
    setSaving(false);
    onDone();
  }
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] p-3">
      <div className="grid grid-cols-2 gap-3">
        {field('calories', 'Calories', 'kcal')}{field('protein', 'Protein', 'g')}{field('fat', 'Fat', 'g')}{field('carbs', 'Carbs', 'g')}
      </div>
      {off && (
        <div role="alert" className="space-y-2 rounded-lg border border-[color-mix(in_srgb,var(--warn,#e0b45c)_45%,transparent)] bg-[color-mix(in_srgb,var(--warn,#e0b45c)_10%,transparent)] p-2.5 text-xs">
          <p>These don&apos;t add up: P {v.protein} g × 4 + F {v.fat} g × 9 + C {v.carbs} g × 4 = <b>{off.macroKcal} kcal</b>, not {off.calories}. Hitting the macros means eating {Math.abs(off.macroKcal - off.calories)} kcal {off.macroKcal > off.calories ? 'more' : 'less'} than planned.</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setV({ ...v, carbs: off.carbsForCalories })} className="btn btn-secondary btn-sm">Carbs → {off.carbsForCalories} g (keep {off.calories} kcal)</button>
            <button onClick={() => setV({ ...v, calories: off.macroKcal })} className="btn btn-ghost btn-sm">Calories → {off.macroKcal} (keep macros)</button>
          </div>
        </div>
      )}
      <p className="faint text-xs">Or ask the coach to work them out from your height, weight and goal.</p>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn btn-primary btn-sm flex-1">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={onDone} className="btn btn-ghost btn-sm">Cancel</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- coach chat */

function Logged({ actions }: { actions: DietAction[] }) {
  const chips: string[] = [];
  for (const a of actions) {
    for (const i of a.log ?? []) chips.push(`＋ ${i.name} · ${r(i.kcal)} kcal`);
    for (const n of a.remove ?? []) chips.push(`− ${n}`);
    if (a.weight) chips.push(`⚖️ ${a.weight} kg`);
    if (a.targets && Object.keys(a.targets).length) chips.push(`🎯 targets: ${[a.targets.calories && `${r(a.targets.calories)} kcal`, a.targets.protein && `P ${r(a.targets.protein)}`, a.targets.fat && `F ${r(a.targets.fat)}`, a.targets.carbs && `C ${r(a.targets.carbs)}`].filter(Boolean).join(' · ')}`);
    if (a.profile && Object.keys(a.profile).length) chips.push('👤 profile updated');
    for (const w of a.workout ?? []) chips.push(`🏋️ ${w.exercise} ${w.kg ? `${w.kg} kg × ` : ''}${w.reps}${w.sets > 1 ? ` × ${w.sets} sets` : ''}`);
    if (a.replan) chips.push('📋 plan updating — see Training');
  }
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((c, i) => <span key={i} className="rounded-full border border-[color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--brand)_10%,transparent)] px-2.5 py-0.5 text-xs text-[var(--brand-ink)]">{c}</span>)}
    </div>
  );
}

function CoachChat({ msgs, busy, error, onSend, onRetry, onNew, onCheckin, checkinBusy }: { msgs: Msg[]; busy: boolean; error: string | null; onSend: (t: string, photos?: string[]) => void; onRetry?: () => void; onNew: () => void; onCheckin: () => void; checkinBusy: boolean }) {
  const [input, setInput] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs]);
  const submit = (t: string) => {
    if ((!t.trim() && !photos.length) || busy) return;
    onSend(t, photos); setInput(''); setPhotos([]); setPhotoError(null);
    if (taRef.current) taRef.current.style.height = 'auto';
  };
  async function addPhotos(files: FileList | File[] | null) {
    setPhotoError(null);
    const pictures = Array.from(files ?? []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name));
    if (files && Array.from(files).length && !pictures.length) setPhotoError('Only pictures can be added here.');
    for (const f of pictures.slice(0, 3 - photos.length)) {
      try { const url = await shrinkPhoto(f); setPhotos((p) => (p.length >= 3 ? p : [...p, url])); }
      catch (e) { setPhotoError(e instanceof Error ? e.message : 'Could not read that photo.'); }
    }
    if (pictures.length > 3 - photos.length) setPhotoError('Up to 3 pictures per message.');
    for (const r of [fileRef, cameraRef]) if (r.current) r.current.value = '';
  }

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[26rem] flex-col gap-3"
      // on a computer: drop pictures anywhere on the chat
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); if (!busy) void addPhotos(e.dataTransfer.files); } }}>
      <div ref={scrollRef} className={`relative flex-1 overflow-y-auto rounded-2xl border bg-[var(--surface)] ${dragging ? 'border-[var(--brand)] border-dashed' : 'border-[var(--border)]'}`}>
        {dragging && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[color-mix(in_srgb,var(--surface)_85%,transparent)] text-sm font-semibold">Drop pictures to add them</div>}
        {msgs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-3xl" aria-hidden>🥗</div>
            <p className="muted max-w-sm text-sm">Tell the coach about you and your goal, then say what you eat — or upload pictures of your meals and nutrition labels. It logs it and keeps count.</p>
            <div className="flex max-w-md flex-col gap-2">
              {STARTERS.map((t) => <button key={t} onClick={() => submit(t)} className="btn btn-secondary btn-sm h-auto whitespace-normal py-2 text-left">{t}</button>)}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5 p-4 sm:p-5">
            {msgs.map((m, i) => {
              if (m.role === 'user') return (
                <div key={i} className="flex flex-col items-end gap-1.5">
                  {!!m.photos?.length && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {/* eslint-disable-next-line @next/next/no-img-element -- the user's own photo, a data URL */}
                      {m.photos.map((url, k) => <img key={k} src={url} alt="Your photo" className="h-28 w-28 rounded-xl object-cover" />)}
                    </div>
                  )}
                  {(m.photos?.length ? m.content.replace(/^📷 [^\n]*\n?/, '') : m.content) && (
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-[var(--brand)] px-4 py-2.5 text-[15px] leading-relaxed text-white">
                      {m.photos?.length ? m.content.replace(/^📷 [^\n]*\n?/, '') : m.content}
                    </div>
                  )}
                </div>
              );
              const streaming = busy && i === msgs.length - 1;
              const shown = stripDietBlocks(m.content);
              return (
                <div key={i} className="min-w-0">
                  <div className={streaming && !shown ? 'ft-caret' : ''}>{shown ? <Markdown>{shown}</Markdown> : null}</div>
                  {!streaming && <Logged actions={parseDietBlocks(m.content)} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {(error || photoError) && (
        <div className="flex items-center gap-3">
          <p role="alert" className="text-sm text-[var(--danger)]">{error ?? photoError}</p>
          {error && onRetry && <button type="button" className="btn btn-primary shrink-0" disabled={busy} onClick={onRetry}>Retry</button>}
        </div>
      )}
      {photos.length > 0 && (
        <div className="flex gap-2">
          {photos.map((url, k) => (
            <div key={k} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- a preview of the user's own photo */}
              <img src={url} alt="Photo to send" className="h-16 w-16 rounded-lg object-cover" />
              <button onClick={() => setPhotos((p) => p.filter((_, x) => x !== k))} className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-[var(--ink)] text-xs text-[var(--bg)]" aria-label="Remove photo">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2">
        {/* two ways in: pictures already on the device (gallery / files, several at once) or the camera */}
        <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhotos(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} disabled={busy || photos.length >= 3} className="btn btn-ghost shrink-0 px-2 text-lg" title="Upload pictures from your gallery or files" aria-label="Upload pictures">🖼️</button>
        <button onClick={() => cameraRef.current?.click()} disabled={busy || photos.length >= 3} className="btn btn-ghost -ml-1 shrink-0 px-2 text-lg" title="Take a photo" aria-label="Take a photo">📷</button>
        <textarea
          ref={taRef} value={input} rows={1}
          onChange={(e) => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'; }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }}
          // a copied picture (screenshot, image from a website) pastes straight in
          onPaste={(e) => { const files = Array.from(e.clipboardData.files); if (files.length) { e.preventDefault(); void addPhotos(files); } }}
          placeholder={photos.length ? "Anything to add? (or just Send)" : "What did you eat? Or add pictures 🖼️ 📷"}
          className="max-h-[160px] min-w-0 flex-1 resize-none bg-transparent px-2 py-1.5 text-[16px] text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none sm:text-[15px]"
        />
        <button onClick={() => submit(input)} disabled={busy || (!input.trim() && !photos.length)} className="btn btn-primary shrink-0">{busy ? '…' : 'Send'}</button>
      </div>
      {checkinBusy && <p className="muted ft-caret text-sm">📋 Writing your weekly check-in</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {msgs.length > 0 ? <button onClick={onNew} disabled={busy} className="faint text-xs hover:text-[var(--ink)]">Start a new conversation (your log stays)</button> : <span />}
        <button onClick={onCheckin} disabled={busy} className="btn btn-ghost btn-sm text-xs" title="The coach reviews your last 7 days and suggests what to change">📋 Weekly check-in</button>
      </div>
    </div>
  );
}
