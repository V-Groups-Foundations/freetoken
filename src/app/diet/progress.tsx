'use client';

import { useMemo, useRef, useState } from 'react';
import { Markdown } from '../chat/markdown';
import { ACTIVITY, type Activity, type Advice } from '@/diet/advisor';
import { POSES, type Pose } from '@/diet/physique';

export type Photo = {
  id: number; day: string; pose: string; kg: number | null; bodyFatLow: number | null; bodyFatHigh: number | null;
  analysis: string | null; summary: string | null;
};
export type FullProfile = {
  sex: string | null; age: number | null; heightCm: number | null; goal: string | null; calories: number | null; protein: number | null;
  fat: number | null; carbs: number | null; notes: string | null; activity: string | null; goalWeightKg: number | null; photoId: number | null;
} | null;

const bf = (p: Pick<Photo, 'bodyFatLow' | 'bodyFatHigh'>) =>
  p.bodyFatLow == null ? null : p.bodyFatHigh != null && p.bodyFatHigh !== p.bodyFatLow ? `${p.bodyFatLow}–${p.bodyFatHigh}%` : `${p.bodyFatLow}%`;
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
const img = (id: number) => `/api/diet/photos/${id}`;
const POSE_LABEL: Record<string, string> = { front: 'Front', side: 'Side', back: 'Back', other: 'Other' };

/** A phone photo, longest side 1600 px as JPEG (small enough to store and to send to a vision model). */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(/\.hei[cf]$/i.test(file.name) ? `This browser can't open HEIC photos (${file.name}) — choose it from the Photos app on your phone, or save it as JPEG first.` : `Couldn't read ${file.name} as a picture.`);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * scale); c.height = Math.round(bitmap.height * scale);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  return c.toDataURL('image/jpeg', 0.85);
}

async function patchProfile(body: Record<string, unknown>) {
  const res = await fetch('/api/diet/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Could not save.');
}

export function Progress({ profile, advice, weights, photos, today, onChanged }: {
  profile: FullProfile; advice: Advice; weights: { day: string; kg: number }[]; photos: Photo[]; today: string; onChanged: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState<Photo | null>(null);
  const avatar = photos.find((p) => p.id === profile?.photoId) ?? photos.find((p) => p.pose === 'front') ?? photos[0];
  const latestBf = photos.find((p) => p.bodyFatLow != null);

  return (
    <div className="space-y-4">
      <ProfileCard profile={profile} advice={advice} avatar={avatar} latestBf={latestBf} onChanged={onChanged} />
      <Numbers profile={profile} advice={advice} onChanged={onChanged} />
      <WeightCard weights={weights} goal={profile?.goalWeightKg ?? null} today={today} advice={advice} onChanged={onChanged} />
      <PhotosCard photos={photos} today={today} onOpen={setOpen} onChanged={onChanged} />
      {photos.length > 1 && <Compare photos={photos} />}
      {open && <PhotoSheet photo={open} isAvatar={profile?.photoId === open.id} today={today}
        onClose={() => setOpen(null)} onChanged={async (next) => { await onChanged(); setOpen(next); }} />}
    </div>
  );
}

/* ---------------------------------------------------------------- profile */

function ProfileCard({ profile: p, advice: a, avatar, latestBf, onChanged }: { profile: FullProfile; advice: Advice; avatar?: Photo; latestBf?: Photo; onChanged: () => Promise<unknown> }) {
  const [editing, setEditing] = useState(false);
  const facts = [
    p?.sex && (p.sex === 'male' ? 'Male' : 'Female'), p?.age && `${p.age} y`, p?.heightCm && `${p.heightCm} cm`,
    p?.activity && ACTIVITY[p.activity as Activity]?.label.split(' (')[0],
  ].filter(Boolean);
  return (
    <div className="card card-pad space-y-4">
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- the user's own photo, served privately */}
          {avatar ? <img src={img(avatar.id)} alt="Your profile photo" className="h-full w-full object-cover object-top" /> : <div className="grid h-full place-items-center text-3xl" aria-hidden>🏋️</div>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Your profile</div>
          <div className="mt-1 text-sm">{facts.length ? facts.join(' · ') : <span className="faint">Add your details so the coach can work out your numbers.</span>}</div>
          {p?.goal && <div className="muted mt-0.5 text-sm">Goal: <b className="text-[var(--ink)]">{p.goal}</b>{p.goalWeightKg ? ` → ${p.goalWeightKg} kg` : ''}</div>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Weight" value={a.weightKg ? `${a.weightKg}` : '—'} unit="kg" />
        <Stat label="Body fat" value={latestBf ? bf(latestBf)!.replace('%', '') : '—'} unit={latestBf ? '% est.' : ''} />
        <Stat label="BMI" value={a.bmi ? `${a.bmi}` : '—'} unit="" />
      </div>
      {editing ? <ProfileForm p={p} onDone={async (saved) => { if (saved) await onChanged(); setEditing(false); }} />
        : <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm w-full">{facts.length ? 'Edit profile' : 'Set up profile'}</button>}
    </div>
  );
}

function Stat({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2.5">
      <div className="faint text-[11px] uppercase tracking-wide">{label}</div>
      <div className={`display mt-0.5 text-xl font-bold tabular-nums ${tone === 'good' ? 'text-[var(--success,#3ccf91)]' : tone === 'bad' ? 'text-[var(--danger)]' : ''}`}>{value}<span className="faint ml-0.5 text-xs font-normal">{unit}</span></div>
    </div>
  );
}

function ProfileForm({ p, onDone }: { p: FullProfile; onDone: (saved: boolean) => void }) {
  const [v, setV] = useState({
    sex: p?.sex ?? '', age: p?.age?.toString() ?? '', heightCm: p?.heightCm?.toString() ?? '', activity: p?.activity ?? '',
    goal: p?.goal ?? '', goalWeightKg: p?.goalWeightKg?.toString() ?? '', notes: p?.notes ?? '',
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const num = (x: string) => (x.trim() === '' ? null : Number(x));
  async function save() {
    setSaving(true); setErr(null);
    try {
      await patchProfile({ sex: v.sex || null, age: num(v.age), heightCm: num(v.heightCm), activity: v.activity || null, goal: v.goal.trim() || null, goalWeightKg: num(v.goalWeightKg), notes: v.notes.trim() || null });
      onDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save.'); } finally { setSaving(false); }
  }
  const box = 'input w-full text-[16px] sm:text-sm';
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] p-3">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label><span className="muted">Sex</span>
          <select value={v.sex} onChange={(e) => setV({ ...v, sex: e.target.value })} className={`select mt-1 w-full text-[16px] sm:text-sm`}>
            <option value="">—</option><option value="male">Male</option><option value="female">Female</option>
          </select></label>
        <label><span className="muted">Age</span><input inputMode="numeric" value={v.age} onChange={(e) => setV({ ...v, age: e.target.value.replace(/[^\d]/g, '') })} className={`${box} mt-1`} /></label>
        <label><span className="muted">Height (cm)</span><input inputMode="decimal" value={v.heightCm} onChange={(e) => setV({ ...v, heightCm: e.target.value.replace(/[^\d.]/g, '') })} className={`${box} mt-1`} /></label>
        <label><span className="muted">Goal weight (kg)</span><input inputMode="decimal" value={v.goalWeightKg} onChange={(e) => setV({ ...v, goalWeightKg: e.target.value.replace(/[^\d.]/g, '') })} className={`${box} mt-1`} /></label>
        <label className="col-span-2"><span className="muted">Activity</span>
          <select value={v.activity} onChange={(e) => setV({ ...v, activity: e.target.value })} className="select mt-1 w-full text-[16px] sm:text-sm">
            <option value="">—</option>{Object.entries(ACTIVITY).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
          </select></label>
        <label className="col-span-2"><span className="muted">Goal</span>
          <input value={v.goal} maxLength={80} onChange={(e) => setV({ ...v, goal: e.target.value })} placeholder="e.g. cut to visible abs, lean bulk, recomp" className={`${box} mt-1`} /></label>
        <label className="col-span-2"><span className="muted">Notes for the coach</span>
          <input value={v.notes} maxLength={600} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="training days, allergies, foods you dislike…" className={`${box} mt-1`} /></label>
      </div>
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn btn-primary btn-sm flex-1">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => onDone(false)} className="btn btn-ghost btn-sm">Cancel</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- the coach's numbers */

function Numbers({ profile: p, advice: a, onChanged }: { profile: FullProfile; advice: Advice; onChanged: () => Promise<unknown> }) {
  const [saving, setSaving] = useState(false);
  const s = a.suggested;
  const same = s && p?.calories === s.calories && p?.protein === s.protein && p?.fat === s.fat && p?.carbs === s.carbs;
  const trendTone = a.trendKgPerWeek == null || !a.safeRateKgPerWeek ? undefined
    : a.trendKgPerWeek >= a.safeRateKgPerWeek[0] - 0.05 && a.trendKgPerWeek <= a.safeRateKgPerWeek[1] + 0.05 ? 'good' : 'bad';
  return (
    <div className="card card-pad space-y-4">
      <div>
        <div className="eyebrow">Your numbers</div>
        <p className="faint mt-1 text-xs">Worked out from your profile, weigh-ins and food log — the coach uses the same numbers.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Maintenance" value={a.observedMaintenance ? `${a.observedMaintenance}` : a.maintenance ? `${a.maintenance}` : '—'} unit="kcal" />
        <Stat label="Trend" value={a.trendKgPerWeek == null ? '—' : `${a.trendKgPerWeek > 0 ? '+' : ''}${a.trendKgPerWeek}`} unit="kg/wk" tone={trendTone} />
        <Stat label="7-day avg" value={a.adherence ? `${a.adherence.avgKcal}` : '—'} unit="kcal" />
        <Stat label="Goal in" value={a.goalEta ? `${a.goalEta.weeks}` : '—'} unit={a.goalEta ? 'weeks' : ''} />
      </div>
      <ul className="muted space-y-1 text-sm">
        {a.observedMaintenance && a.maintenance && <li>Your log and weight say you burn about <b className="text-[var(--ink)]">{a.observedMaintenance} kcal</b> a day (the formula guessed {a.maintenance}).</li>}
        {!a.observedMaintenance && a.maintenance && <li>Estimated maintenance <b className="text-[var(--ink)]">{a.maintenance} kcal</b> (BMR {a.bmr}). After two weeks of logging and weigh-ins this becomes your real number.</li>}
        {a.safeRateKgPerWeek && <li>A good pace for your goal: <b className="text-[var(--ink)]">{a.safeRateKgPerWeek[0]} to {a.safeRateKgPerWeek[1]} kg</b> a week.</li>}
        {a.adherence && p?.calories && <li>Last 7 days: {a.adherence.daysLogged} logged, {a.adherence.daysOnTarget} within 10% of your calories, protein {a.adherence.avgProtein} g/day{p.protein ? ` (target ${p.protein})` : ''}.</li>}
        {a.goalEta && <li>At this rate you reach {p?.goalWeightKg} kg around <b className="text-[var(--ink)]">{fmtDay(a.goalEta.date)}</b>.</li>}
        {a.targetsMismatch && <li className="text-[var(--warn,#e0b45c)]">Your targets don&apos;t add up: the macros come to {a.targetsMismatch.macroKcal} kcal, not {a.targetsMismatch.calories}. Fix them under Coach → Edit targets, or use the recommendation below.</li>}
        {a.missing.length > 0 && <li className="text-[var(--warn,#e0b45c)]">Missing for better numbers: {a.missing.join(', ')}.</li>}
      </ul>
      {s && (
        <div className="rounded-xl border border-[color-mix(in_srgb,var(--brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--brand)_8%,transparent)] p-3">
          <div className="text-sm font-semibold">Recommended daily targets <span className="faint font-normal">({a.goal})</span></div>
          <div className="mt-1 tabular-nums">{s.calories} kcal · P {s.protein} g · F {s.fat} g · C {s.carbs} g</div>
          {p?.calories && !same && <div className="faint mt-0.5 text-xs tabular-nums">Now: {p.calories} kcal · P {p.protein ?? '?'} · F {p.fat ?? '?'} · C {p.carbs ?? '?'}</div>}
          {same ? <div className="mt-2 text-xs text-[var(--success,#3ccf91)]">✓ These are your targets.</div> : (
            <button disabled={saving} onClick={async () => { setSaving(true); try { await patchProfile(s); await onChanged(); } finally { setSaving(false); } }}
              className="btn btn-primary btn-sm mt-2">{saving ? 'Saving…' : 'Use these targets'}</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- weight */

function WeightCard({ weights, goal, today, advice, onChanged }: { weights: { day: string; kg: number }[]; goal: number | null; today: string; advice: Advice; onChanged: () => Promise<unknown> }) {
  const [range, setRange] = useState(90);
  const [kg, setKg] = useState('');
  const [saving, setSaving] = useState(false);
  const shown = useMemo(() => {
    const from = new Date(`${today}T12:00:00`); from.setDate(from.getDate() - range);
    const f = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    return weights.filter((w) => w.day >= f);
  }, [weights, range, today]);
  async function add() {
    if (!kg) return;
    setSaving(true);
    try { await fetch('/api/diet/weights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kg: Number(kg), day: today }) }); setKg(''); await onChanged(); }
    finally { setSaving(false); }
  }
  const first = shown[0], last = shown.at(-1);
  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-center justify-between">
        <div className="eyebrow">Weight</div>
        <div className="flex gap-1">{[30, 90, 365].map((d) => <button key={d} onClick={() => setRange(d)} className={`btn btn-sm ${range === d ? 'btn-secondary' : 'btn-ghost'} px-2 text-xs`}>{d === 365 ? '1y' : `${d}d`}</button>)}</div>
      </div>
      {shown.length >= 2 ? <WeightChart points={shown} goal={goal} /> : <p className="faint py-6 text-center text-sm">Weigh in a few times to see your trend.</p>}
      {first && last && first.day !== last.day && (
        <p className="muted text-sm">
          {last.kg - first.kg > 0 ? '+' : ''}{(last.kg - first.kg).toFixed(1)} kg since {fmtDay(first.day)}
          {advice.trendKgPerWeek != null && <> · trend {advice.trendKgPerWeek > 0 ? '+' : ''}{advice.trendKgPerWeek} kg/week</>}
        </p>
      )}
      <div className="flex gap-2">
        <input inputMode="decimal" value={kg} onChange={(e) => setKg(e.target.value.replace(/[^\d.]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Today's weight (kg)" className="input min-w-0 flex-1 text-[16px] sm:text-sm" aria-label="Today's weight in kg" />
        <button onClick={add} disabled={saving || !kg} className="btn btn-primary btn-sm shrink-0">{saving ? '…' : 'Log'}</button>
      </div>
    </div>
  );
}

function WeightChart({ points, goal }: { points: { day: string; kg: number }[]; goal: number | null }) {
  const W = 320, H = 140, pad = { l: 34, r: 8, t: 10, b: 20 };
  const t = (d: string) => Date.parse(`${d}T12:00:00Z`);
  const x0 = t(points[0].day), x1 = Math.max(t(points.at(-1)!.day), x0 + 86_400_000);
  const ks = points.map((p) => p.kg).concat(goal && Math.abs(goal - points.at(-1)!.kg) < 15 ? [goal] : []);
  const y0 = Math.floor(Math.min(...ks) - 0.5), y1 = Math.ceil(Math.max(...ks) + 0.5);
  const X = (d: string) => pad.l + ((t(d) - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const Y = (k: number) => pad.t + (1 - (k - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.day).toFixed(1)},${Y(p.kg).toFixed(1)}`).join(' ');
  const ticks = [y0, (y0 + y1) / 2, y1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Weight from ${points[0].kg} to ${points.at(-1)!.kg} kg`}>
      {ticks.map((k) => <g key={k}><line x1={pad.l} x2={W - pad.r} y1={Y(k)} y2={Y(k)} stroke="var(--border)" strokeWidth="1" /><text x={pad.l - 6} y={Y(k) + 3} textAnchor="end" fontSize="9" fill="var(--faint)">{Math.round(k * 10) / 10}</text></g>)}
      {goal != null && goal >= y0 && goal <= y1 && <g><line x1={pad.l} x2={W - pad.r} y1={Y(goal)} y2={Y(goal)} stroke="var(--success,#3ccf91)" strokeDasharray="4 3" strokeWidth="1.2" /><text x={W - pad.r} y={Y(goal) - 3} textAnchor="end" fontSize="9" fill="var(--success,#3ccf91)">goal {goal}</text></g>}
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p) => <circle key={p.day} cx={X(p.day)} cy={Y(p.kg)} r="2.5" fill="var(--brand)"><title>{`${p.day}: ${p.kg} kg`}</title></circle>)}
      <text x={pad.l} y={H - 4} fontSize="9" fill="var(--faint)">{fmtDay(points[0].day)}</text>
      <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="9" fill="var(--faint)">{fmtDay(points.at(-1)!.day)}</text>
    </svg>
  );
}

/* ---------------------------------------------------------------- photos */

function PhotosCard({ photos, today, onOpen, onChanged }: { photos: Photo[]; today: string; onOpen: (p: Photo) => void; onChanged: () => Promise<unknown> }) {
  const [pose, setPose] = useState<Pose>('front');
  const [analyze, setAnalyze] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  async function upload(files: FileList | null) {
    const f = files?.[0];
    for (const r of [fileRef, cameraRef]) if (r.current) r.current.value = '';
    if (!f) return;
    setErr(null);
    try {
      setBusy('Preparing photo…');
      const image = await shrink(f);
      setBusy(analyze ? 'Saving and analysing — this can take up to a minute…' : 'Saving…');
      const res = await fetch('/api/diet/photos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image, pose, day: today, analyze }) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? `Upload failed (${res.status})`);
      if (j?.error) setErr(`Saved, but the analysis failed: ${j.error} Open the photo to try again.`);
      await onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Upload failed.'); } finally { setBusy(null); }
  }
  return (
    <div className="card card-pad space-y-3">
      <div>
        <div className="eyebrow">Progress photos</div>
        <p className="faint mt-1 text-xs">Same pose, light and time of day each time (e.g. morning, before eating) makes the comparison honest. Private to your account.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5" role="radiogroup" aria-label="Pose">
          {POSES.map((p) => <button key={p} role="radio" aria-checked={pose === p} onClick={() => setPose(p)} className={`rounded-md px-2.5 py-1 text-xs ${pose === p ? 'bg-[var(--surface-2)] font-semibold text-[var(--ink)]' : 'muted'}`}>{POSE_LABEL[p]}</button>)}
        </div>
        <label className="muted flex items-center gap-1.5 text-xs"><input type="checkbox" checked={analyze} onChange={(e) => setAnalyze(e.target.checked)} /> Coach analyses it</label>
      </div>
      <input ref={fileRef} type="file" accept="image/*,.heic,.heif" className="hidden" onChange={(e) => upload(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => upload(e.target.files)} />
      {busy ? <button disabled className="btn btn-primary w-full">{busy}</button> : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => fileRef.current?.click()} className="btn btn-primary">🖼️ Upload a photo</button>
          <button onClick={() => cameraRef.current?.click()} className="btn btn-secondary">📸 Take one now</button>
        </div>
      )}
      {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
      {photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <button key={p.id} onClick={() => onOpen(p)} className="group relative aspect-[3/4] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-left">
              {/* eslint-disable-next-line @next/next/no-img-element -- the user's own photo, served privately */}
              <img src={img(p.id)} alt={`${POSE_LABEL[p.pose] ?? p.pose} photo, ${p.day}`} loading="lazy" className="h-full w-full object-cover object-top transition-transform group-hover:scale-[1.03]" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-5 text-[11px] leading-tight text-white">
                <div className="font-semibold">{fmtDay(p.day)}</div>
                <div className="opacity-80">{POSE_LABEL[p.pose] ?? p.pose}{p.kg ? ` · ${p.kg} kg` : ''}{bf(p) ? ` · ${bf(p)}` : ''}</div>
              </div>
            </button>
          ))}
        </div>
      ) : <p className="faint py-4 text-center text-sm">No photos yet. Your first one is your &ldquo;before&rdquo;.</p>}
    </div>
  );
}

function Compare({ photos }: { photos: Photo[] }) {
  const poses = POSES.filter((p) => photos.filter((x) => x.pose === p).length >= 2);
  const [pose, setPose] = useState<string>(poses[0] ?? '');
  if (!poses.length) return null;
  const list = photos.filter((p) => p.pose === (poses.includes(pose as Pose) ? pose : poses[0]));
  const before = list.at(-1)!, after = list[0];
  const days = Math.round((Date.parse(after.day) - Date.parse(before.day)) / 86_400_000);
  const dKg = before.kg != null && after.kg != null ? after.kg - before.kg : null;
  const dBf = before.bodyFatLow != null && after.bodyFatLow != null ? ((after.bodyFatLow + (after.bodyFatHigh ?? after.bodyFatLow)) - (before.bodyFatLow + (before.bodyFatHigh ?? before.bodyFatLow))) / 2 : null;
  return (
    <div className="card card-pad space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="eyebrow">Before / now</div>
        {poses.length > 1 && <select value={pose} onChange={(e) => setPose(e.target.value)} className="select py-1 text-xs">{poses.map((p) => <option key={p} value={p}>{POSE_LABEL[p]}</option>)}</select>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[before, after].map((p, i) => (
          <figure key={p.id} className="overflow-hidden rounded-xl border border-[var(--border)]">
            {/* eslint-disable-next-line @next/next/no-img-element -- the user's own photo, served privately */}
            <img src={img(p.id)} alt={`${i ? 'Latest' : 'First'} ${p.pose} photo`} className="aspect-[3/4] w-full object-cover object-top" />
            <figcaption className="px-2 py-1.5 text-xs"><b>{i ? 'Now' : 'Before'}</b> · {fmtDay(p.day)}{p.kg ? ` · ${p.kg} kg` : ''}{bf(p) ? ` · ${bf(p)}` : ''}</figcaption>
          </figure>
        ))}
      </div>
      <p className="muted text-sm">
        {days} days apart{dKg != null && <> · <b className="text-[var(--ink)]">{dKg > 0 ? '+' : ''}{dKg.toFixed(1)} kg</b></>}{dBf != null && <> · body fat <b className="text-[var(--ink)]">{dBf > 0 ? '+' : ''}{dBf.toFixed(1)}%</b> (estimated)</>}
      </p>
    </div>
  );
}

function PhotoSheet({ photo: p, isAvatar, today, onClose, onChanged }: { photo: Photo; isAvatar: boolean; today: string; onClose: () => void; onChanged: (next: Photo | null) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  async function act(label: string, fn: () => Promise<Photo | null>) {
    setBusy(label); setErr(null);
    try { await onChanged(await fn()); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong.'); } finally { setBusy(null); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--surface)] sm:rounded-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Progress photo">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="text-sm"><b>{fmtDay(p.day)}</b> · {POSE_LABEL[p.pose] ?? p.pose}{p.kg ? ` · ${p.kg} kg` : ''}{bf(p) ? ` · ~${bf(p)} body fat` : ''}</div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">✕</button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- the user's own photo, served privately */}
        <img src={img(p.id)} alt={`${p.pose} progress photo`} className="max-h-[55dvh] w-full bg-black object-contain" />
        <div className="space-y-3 p-4">
          {busy === 'analyse' ? <p className="muted ft-caret text-sm">Analysing — up to a minute</p>
            : p.analysis ? <div className="text-sm"><Markdown>{p.analysis}</Markdown></div>
            : <p className="faint text-sm">Not analysed yet.</p>}
          {err && <p className="text-sm text-[var(--danger)]">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button disabled={!!busy} onClick={() => act('analyse', async () => {
              const res = await fetch(`/api/diet/photos/${p.id}?day=${today}`, { method: 'POST' });
              const j = await res.json().catch(() => null);
              if (!res.ok) throw new Error(j?.error ?? 'The analysis failed.');
              const a = j.analysis as { text: string; bodyFatLow: number | null; bodyFatHigh: number | null; summary: string | null };
              return { ...p, analysis: a.text, bodyFatLow: a.bodyFatLow, bodyFatHigh: a.bodyFatHigh, summary: a.summary };
            })} className="btn btn-secondary btn-sm">{p.analysis ? '↻ Analyse again' : '🔍 Analyse'}</button>
            {!isAvatar && <button disabled={!!busy} onClick={() => act('avatar', async () => { await patchProfile({ photoId: p.id }); return p; })} className="btn btn-secondary btn-sm">Use as profile photo</button>}
            {isAvatar && <span className="faint self-center text-xs">✓ Profile photo</span>}
            {confirmDelete ? (
              <button disabled={!!busy} onClick={() => act('delete', async () => { const res = await fetch(`/api/diet/photos/${p.id}`, { method: 'DELETE' }); if (!res.ok) throw new Error('Could not delete.'); return null; })}
                className="btn btn-sm ml-auto bg-[var(--danger)] text-white">Delete for good</button>
            ) : <button disabled={!!busy} onClick={() => setConfirmDelete(true)} className="btn btn-ghost btn-sm ml-auto text-[var(--danger)]">Delete</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
