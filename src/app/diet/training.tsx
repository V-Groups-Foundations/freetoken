'use client';

import { useCallback, useEffect, useState } from 'react';
import { Markdown } from '../chat/markdown';
import { EQUIPMENT, EXPERIENCE, type TrainingPlan } from '@/diet/training';

type Next = { kg: number; reps: number; why: string } | null;
type Details = { trainDays: number | null; sessionMinutes: number | null; experience: string | null; equipment: string | null; injuries: string | null };
type Data = {
  details: Details; missing: string[];
  plan: { id: number; plan: TrainingPlan; change: string | null; source: string; createdAt: string; next: Next[][]; nextDay: number } | null;
  history: { id: number; change: string | null; source: string; createdAt: string }[];
  today: { id: number; exercise: string; kg: number; reps: number }[];
  progress: Record<string, { day: string; kg: number; reps: number; e1rm: number }[]>;
};

const SOURCE: Record<string, string> = { new: '✨ first plan', request: '✍️ your request', photo: '📷 after a progress photo', chat: '💬 from the chat' };
const fmt = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const rest = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);
const setLabel = (kg: number, reps: number) => (kg ? `${kg} kg × ${reps}` : `${reps} reps`);

export function Training({ today, onAsk }: { today: string; onAsk: (text: string) => void }) {
  const [d, setD] = useState<Data | null>(null);
  const load = useCallback(async () => {
    const res = await fetch(`/api/diet/training?today=${today}`);
    if (res.ok) setD(await res.json());
  }, [today]);
  useEffect(() => {
    let live = true;
    fetch(`/api/diet/training?today=${today}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setD(j); }).catch(() => {});
    return () => { live = false; };
  }, [today]);
  if (!d) return <div className="card card-pad muted text-sm">Loading…</div>;
  return (
    <div className="space-y-4">
      <DetailsCard d={d.details} missing={d.missing} onSaved={load} />
      <PlanCard d={d} today={today} onChanged={load} onAsk={onAsk} />
      {/* a new plan version starts the workout form over */}
      {d.plan && <WorkoutCard key={d.plan.id} d={d} today={today} onChanged={load} />}
      {Object.keys(d.progress).length > 0 && <LiftsCard progress={d.progress} />}
    </div>
  );
}

/* ---------------------------------------------------------------- details */

function DetailsCard({ d, missing, onSaved }: { d: Details; missing: string[]; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(missing.length > 0);
  const [v, setV] = useState({ trainDays: d.trainDays?.toString() ?? '', sessionMinutes: d.sessionMinutes?.toString() ?? '', experience: d.experience ?? '', equipment: d.equipment ?? '', injuries: d.injuries ?? '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setSaving(true); setErr(null);
    const num = (x: string) => (x ? Number(x) : null);
    const res = await fetch('/api/diet/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trainDays: num(v.trainDays), sessionMinutes: num(v.sessionMinutes), experience: v.experience || null, equipment: v.equipment || null, injuries: v.injuries.trim() || null }) });
    setSaving(false);
    if (!res.ok) { setErr((await res.json().catch(() => null))?.error ?? 'Could not save.'); return; }
    await onSaved(); setOpen(false);
  }
  const summary = [d.trainDays && `${d.trainDays} days/week`, d.sessionMinutes && `${d.sessionMinutes} min`, d.experience, d.equipment && EQUIPMENT[d.equipment as keyof typeof EQUIPMENT]].filter(Boolean).join(' · ');
  const sel = 'select mt-1 w-full text-[16px] sm:text-sm';
  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="eyebrow">How you train</div>
          <div className="mt-1 text-sm">{summary || <span className="faint">Tell the coach how you train to get a plan.</span>}</div>
          {d.injuries && <div className="faint mt-0.5 text-xs">Avoid: {d.injuries}</div>}
        </div>
        {!open && <button onClick={() => setOpen(true)} className="btn btn-secondary btn-sm shrink-0">Edit</button>}
      </div>
      {open && (
        <div className="space-y-3 rounded-xl border border-[var(--border)] p-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label><span className="muted">Days a week</span>
              <select value={v.trainDays} onChange={(e) => setV({ ...v, trainDays: e.target.value })} className={sel}><option value="">—</option>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label><span className="muted">Minutes a session</span>
              <select value={v.sessionMinutes} onChange={(e) => setV({ ...v, sessionMinutes: e.target.value })} className={sel}><option value="">—</option>{[30, 45, 60, 75, 90, 120].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label><span className="muted">Experience</span>
              <select value={v.experience} onChange={(e) => setV({ ...v, experience: e.target.value })} className={sel}><option value="">—</option>{EXPERIENCE.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}</select></label>
            <label><span className="muted">Equipment</span>
              <select value={v.equipment} onChange={(e) => setV({ ...v, equipment: e.target.value })} className={sel}><option value="">—</option>{Object.entries(EQUIPMENT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="col-span-2"><span className="muted">Injuries or exercises to avoid</span>
              <input value={v.injuries} maxLength={400} onChange={(e) => setV({ ...v, injuries: e.target.value })} placeholder="e.g. lower back — no conventional deadlifts" className="input mt-1 w-full text-[16px] sm:text-sm" /></label>
          </div>
          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn btn-primary btn-sm flex-1">{saving ? 'Saving…' : 'Save'}</button>
            {!missing.length && <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">Cancel</button>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the plan */

function PlanCard({ d, today, onChanged, onAsk }: { d: Data; today: string; onChanged: () => Promise<void>; onAsk: (text: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [openDay, setOpenDay] = useState<number | null>(d.plan?.nextDay ?? 0);
  async function write(body: Record<string, unknown>, label: string) {
    setBusy(label); setErr(null);
    try {
      const res = await fetch('/api/diet/training/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, today }) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `Failed (${res.status})`);
      setAsk(''); await onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(null); }
  }
  if (!d.plan) return (
    <div className="card card-pad space-y-3 text-center">
      <div className="text-3xl" aria-hidden>🏋️</div>
      <p className="muted text-sm">The coach writes a split for your schedule, equipment and goal — with extra work for the areas your progress photos show are lagging.</p>
      {d.missing.length > 0 && <p className="text-xs text-[var(--warn,#e0b45c)]">First add: {d.missing.join(', ')}.</p>}
      <button disabled={!!busy || d.missing.length > 0} onClick={() => write({}, 'Writing your plan — up to a minute…')} className="btn btn-primary w-full">{busy ?? 'Create my training plan'}</button>
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
    </div>
  );
  const p = d.plan.plan;
  return (
    <div className="card card-pad space-y-4">
      <div>
        <div className="eyebrow">Your plan</div>
        <h2 className="display mt-1 text-xl font-bold">{p.name}</h2>
        {p.why && <p className="muted mt-1 text-sm">{p.why}</p>}
      </div>
      {d.plan.change && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] p-3 text-sm">
          <div className="faint mb-1 text-xs">{SOURCE[d.plan.source] ?? d.plan.source} · {fmt(d.plan.createdAt)}</div>
          <Markdown>{d.plan.change}</Markdown>
        </div>
      )}
      <div className="space-y-2">
        {p.days.map((day, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-[var(--border)]">
            <button onClick={() => setOpenDay(openDay === i ? null : i)} className="flex w-full items-center justify-between gap-2 bg-[var(--surface-2)] px-3 py-2.5 text-left">
              <span><b>{day.name}</b>{day.focus && <span className="muted text-sm"> · {day.focus}</span>}</span>
              <span className="flex shrink-0 items-center gap-2 text-xs">{i === d.plan!.nextDay && <span className="rounded-full bg-[var(--brand)] px-2 py-0.5 font-semibold text-white">next</span>}<span className="faint">{openDay === i ? '▴' : '▾'}</span></span>
            </button>
            {openDay === i && (
              <ul className="divide-y divide-[var(--border)]">
                {day.exercises.map((e, k) => {
                  const n = d.plan!.next[i]?.[k];
                  return (
                    <li key={k} className="px-3 py-2.5 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{e.name}</span>
                        <span className="shrink-0 tabular-nums">{e.sets} × {e.reps}<span className="faint text-xs"> · {rest(e.restSec)}</span></span>
                      </div>
                      {e.note && <div className="faint text-xs">{e.note}</div>}
                      {n && <div className="mt-1 inline-block rounded-full bg-[color-mix(in_srgb,var(--success,#3ccf91)_14%,transparent)] px-2 py-0.5 text-xs text-[var(--success,#3ccf91)]" title={n.why}>Next: {setLabel(n.kg, n.reps)} — {n.why}</div>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
      {p.notes.length > 0 && <ul className="muted list-disc space-y-1 pl-5 text-sm">{p.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      <div className="space-y-2">
        <div className="flex gap-2">
          <input value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={600} onKeyDown={(e) => e.key === 'Enter' && ask.trim() && write({ instruction: ask.trim() }, 'Updating your plan…')}
            placeholder="Change something: more arms, no barbell squats, 5 days…" className="input min-w-0 flex-1 text-[16px] sm:text-sm" aria-label="Ask for a change to your plan" />
          <button disabled={!!busy || !ask.trim()} onClick={() => write({ instruction: ask.trim() }, 'Updating your plan…')} className="btn btn-primary btn-sm shrink-0">Change</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={!!busy} onClick={() => write({ fresh: true }, 'Writing a fresh plan…')} className="btn btn-secondary btn-sm">↻ Fresh plan</button>
          <button onClick={() => onAsk(`Looking at my training plan and recent lifts, what should I focus on to look more muscular while I cut?`)} className="btn btn-ghost btn-sm">💬 Ask the coach about it</button>
        </div>
        {busy && <p className="muted ft-caret text-sm">{busy}</p>}
        {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      </div>
      {d.history.length > 1 && (
        <details className="text-sm">
          <summary className="faint cursor-pointer text-xs">Plan history ({d.history.length})</summary>
          <ul className="mt-2 space-y-2">
            {d.history.slice(1).map((h) => <li key={h.id} className="faint text-xs"><b>{fmt(h.createdAt)}</b> · {SOURCE[h.source] ?? h.source} — {(h.change ?? '').replace(/\s+/g, ' ').slice(0, 220)}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- log a workout */

function WorkoutCard({ d, today, onChanged }: { d: Data; today: string; onChanged: () => Promise<void> }) {
  const plan = d.plan!;
  const [dayIdx, setDayIdx] = useState(plan.nextDay);
  const day = plan.plan.days[dayIdx] ?? plan.plan.days[0];
  const blank = useCallback((i: number) => plan.plan.days[i].exercises.map((e, k) => {
    const n = plan.next[i]?.[k];
    return Array.from({ length: e.sets }, () => ({ kg: n?.kg ? String(n.kg) : '', reps: '' }));
  }), [plan]);
  const [rows, setRows] = useState(() => blank(plan.nextDay));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  function pick(i: number) { setDayIdx(i); setRows(blank(i)); setMsg(null); }
  const set = (ex: number, k: number, key: 'kg' | 'reps', val: string) => setRows((r) => r.map((sets, i) => (i !== ex ? sets : sets.map((s, j) => (j === k ? { ...s, [key]: val.replace(/[^\d.]/g, '') } : s)))));
  async function save() {
    const sets = rows.flatMap((list, i) => list.filter((s) => s.reps).map((s) => ({ exercise: day.exercises[i].name, kg: Number(s.kg || 0), reps: Number(s.reps) })));
    if (!sets.length) { setMsg('Fill in the reps of the sets you did.'); return; }
    setSaving(true);
    const res = await fetch('/api/diet/training/sets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ day: today, sets }) });
    setSaving(false);
    if (!res.ok) { setMsg((await res.json().catch(() => null))?.error ?? 'Could not save.'); return; }
    setMsg(`✓ Logged ${sets.length} sets.`); await onChanged(); setRows(blank(dayIdx));
  }
  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">Log today&apos;s workout</div>
        <select value={dayIdx} onChange={(e) => pick(Number(e.target.value))} className="select py-1 text-sm" aria-label="Which plan day">
          {plan.plan.days.map((x, i) => <option key={i} value={i}>{x.name}{i === plan.nextDay ? ' (next)' : ''}</option>)}
        </select>
      </div>
      <p className="faint text-xs">Weights are filled in from your progressive-overload targets — type the reps you got (and change the weight if needed). Or just tell the coach: &ldquo;bench 80 kg 3×8&rdquo;.</p>
      <div className="space-y-3">
        {day.exercises.map((e, i) => {
          const n = plan.next[dayIdx]?.[i];
          return (
            <div key={i}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-sm"><b>{e.name}</b><span className="faint text-xs">{e.sets} × {e.reps}{n ? ` · aim ${setLabel(n.kg, n.reps)}` : ''}</span></div>
              <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-2 gap-y-1.5">
                {rows[i]?.map((s, k) => (
                  <div key={k} className="contents">
                    <span className="faint w-10 text-xs">Set {k + 1}</span>
                    <input inputMode="decimal" value={s.kg} onChange={(ev) => set(i, k, 'kg', ev.target.value)} placeholder="kg" aria-label={`${e.name} set ${k + 1} weight`} className="input py-1.5 text-[16px] sm:text-sm" />
                    <input inputMode="numeric" value={s.reps} onChange={(ev) => set(i, k, 'reps', ev.target.value)} placeholder={n ? `${n.reps} reps` : 'reps'} aria-label={`${e.name} set ${k + 1} reps`} className="input py-1.5 text-[16px] sm:text-sm" />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={save} disabled={saving} className="btn btn-primary w-full">{saving ? 'Saving…' : 'Save workout'}</button>
      {msg && <p className={`text-sm ${msg.startsWith('✓') ? 'text-[var(--success,#3ccf91)]' : 'text-[var(--danger)]'}`}>{msg}</p>}
      {d.today.length > 0 && (
        <div>
          <div className="faint mb-1 text-xs">Logged today</div>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {d.today.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-1">
                <span>{s.exercise} <span className="muted tabular-nums">{setLabel(s.kg, s.reps)}</span></span>
                <button onClick={async () => { await fetch(`/api/diet/training/sets/${s.id}`, { method: 'DELETE' }); await onChanged(); }} className="faint px-2 hover:text-[var(--danger)]" aria-label={`Remove ${s.exercise} set`}>×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- strength progress */

function LiftsCard({ progress }: { progress: Data['progress'] }) {
  const lifts = Object.entries(progress).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  return (
    <div className="card card-pad space-y-3">
      <div className="eyebrow">Strength</div>
      <ul className="space-y-2.5">
        {lifts.map(([name, s]) => {
          const first = s[0], last = s.at(-1)!;
          const diff = last.e1rm - first.e1rm;
          const max = Math.max(...s.map((x) => x.e1rm || x.reps)), min = Math.min(...s.map((x) => x.e1rm || x.reps));
          const pts = s.map((x, i) => `${s.length === 1 ? 50 : (i / (s.length - 1)) * 100},${20 - (((x.e1rm || x.reps) - min) / (max - min || 1)) * 18 - 1}`).join(' ');
          return (
            <li key={name} className="flex items-center gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{name}</div>
                <div className="faint text-xs tabular-nums">last {setLabel(last.kg, last.reps)} ({last.day.slice(5)}){s.length > 1 && last.e1rm ? <> · est. 1RM <span className={diff >= 0 ? 'text-[var(--success,#3ccf91)]' : 'text-[var(--danger)]'}>{diff >= 0 ? '+' : ''}{diff.toFixed(1)} kg</span></> : null}</div>
              </div>
              <svg viewBox="0 0 100 20" className="h-6 w-20 shrink-0" aria-hidden><polyline points={pts} fill="none" stroke="var(--brand)" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
