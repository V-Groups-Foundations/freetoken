// Benchmark your models: the same small coding tasks for each chosen model, graded by running the
// result. Results are side by side, and go to FreeToken so auto routing learns from them — the panel
// then shows how routing ranks the models for agent work.
import { useEffect, useState } from "react";
import { api, type BenchResult, type RouterScores } from "./api";
import { shortModel } from "./models";

const TASK_TITLES: Record<string, string> = { "fix-bug": "Fix a failing test", "new-program": "Write a small program", rename: "Rename across files", feature: "Add a feature with a test" };
const TASK_SHORT: Record<string, string> = { "fix-bug": "Bug fix", "new-program": "Program", rename: "Rename", feature: "Feature" };
const fmt = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

export function BenchmarkPanel({ onClose, busy }: { onClose: () => void; busy: boolean }) {
  const [models, setModels] = useState<string[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<BenchResult[]>([]);
  const [current, setCurrent] = useState<{ model: string; task: string } | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [scores, setScores] = useState<RouterScores | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);

  useEffect(() => {
    api.benchModels().then((m) => { setModels(m); setPicked(new Set(m.slice(0, 3))); }).catch((e) => { setModels([]); setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); });
    // a run in progress (the panel was closed and opened again) wins over the last finished one
    Promise.all([api.benchProgress().catch(() => null), api.benchLast().catch(() => null)]).then(([p, l]) => {
      if (p) { setResults(p.results); setCurrent(p.current); setState("running"); }
      else if (l) { setResults(l.results); setLastAt(l.at); }
    });
    api.benchScores().then(setScores).catch(() => {});
    return api.onBenchEvent((e) => {
      if (e.type === "start") setCurrent({ model: e.model, task: e.task });
      else if (e.type === "result") setResults((r) => [...r, e.result]);
      else if (e.type === "done") { setCurrent(null); setState("done"); setLastAt(Date.now()); api.benchScores().then(setScores).catch(() => {}); }
    });
  }, []);

  async function start() {
    setResults([]); setError(null); setState("running");
    try { await api.benchStart([...picked]); }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); setState("idle"); setCurrent(null); }
  }
  const toggle = (m: string) => setPicked((p) => { const n = new Set(p); if (n.has(m)) n.delete(m); else if (n.size < 6) n.add(m); return n; });
  const byModel = [...new Set(results.map((r) => r.model))];
  const tasks = Object.keys(TASK_TITLES);

  return (
    <div className="mem-panel bench-panel" role="dialog" aria-label="Benchmark">
      <div className="mem-head"><b>Benchmark your models</b><span className="spacer" /><button className="icon-btn" onClick={onClose} aria-label="Close benchmark">✕</button></div>
      <p className="muted small">Runs the same {tasks.length} coding tasks on each model you pick, in throwaway projects, and checks the results by running them. FreeToken's auto routing learns from the results. It uses roughly 10–25 requests per task of each model's free quota.</p>
      {error && <div className="skill-state error" role="alert">{error}</div>}
      {models === null ? <p className="muted small">Loading your models…</p> : (
        <div className="bench-models" role="group" aria-label="Models to benchmark">
          {models.map((m) => (
            <label key={m} className="bench-model" title={m}>
              <input type="checkbox" checked={picked.has(m)} onChange={() => toggle(m)} disabled={state === "running"} /> {shortModel(m)} <span className="muted">· {m.split("/")[0]}</span>
            </label>
          ))}
        </div>
      )}
      <div className="share-actions">
        {state === "running"
          ? <button className="btn small" onClick={() => api.benchCancel()}>Cancel</button>
          : <button className="btn small primary" onClick={start} disabled={!picked.size || busy} title={busy ? "Wait for the agent to finish" : undefined}>Run benchmark ({picked.size} model{picked.size === 1 ? "" : "s"})</button>}
        {current && <span className="muted small" role="status">Running {TASK_TITLES[current.task] ?? current.task} on {shortModel(current.model)}…</span>}
        {!current && lastAt && state !== "running" && <span className="muted small">Last run {new Date(lastAt).toLocaleString()}</span>}
      </div>
      {byModel.length > 0 && (
        <table className="bench-table">
          <thead><tr><th>Model</th>{tasks.map((t) => <th key={t} title={TASK_TITLES[t]}>{TASK_SHORT[t] ?? t}</th>)}<th title="Tasks passed, and the time they took">Result</th></tr></thead>
          <tbody>
            {byModel.map((m) => {
              const rs = results.filter((r) => r.model === m);
              return (
                <tr key={m}>
                  <td title={m}>{shortModel(m)}</td>
                  {tasks.map((t) => { const r = rs.find((x) => x.task === t); return <td key={t} className={r ? (r.ok ? "pass" : "fail") : ""} title={r?.why ?? (r ? `${r.steps} steps` : "")}>{r ? (r.ok ? "✓" : "✗") : "…"}</td>; })}
                  <td className="bench-result">{rs.filter((r) => r.ok).length}/{rs.length} <span className="muted">· {fmt(rs.reduce((n, r) => n + r.ms, 0))}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {scores && scores.models.length > 0 && (
        <details className="bench-scores" open={state === "done"}>
          <summary className="small">How auto routing ranks your models for agent work now</summary>
          <ol>
            {scores.models.slice(0, 8).map((m) => (
              <li key={m.model} className="small"><b>{shortModel(m.model)}</b> <span className="muted">· {m.model.split("/")[0]} · {m.score}{m.learned ? ` (${m.learned > 0 ? "+" : ""}${m.learned} learned)` : ""}</span></li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
