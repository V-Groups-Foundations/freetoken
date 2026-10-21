// The project's safety net: every snapshot V-Run took (before a task, at each finished plan step, after
// it), newest first. Restoring one puts the files back — and saves the current state first, so a
// restore shows up here too and can be undone the same way.
import { useEffect, useState } from "react";
import { api, type HistorySnapshot } from "./api";

const ago = (t: number) => {
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleString();
};

export function HistoryPanel({ onClose, busy, onRestored }: { onClose: () => void; busy: boolean; onRestored: (files: string[]) => void }) {
  const [list, setList] = useState<HistorySnapshot[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [state, setState] = useState<{ kind: "idle" | "working" | "ok" | "error"; text?: string }>({ kind: "idle" });
  const refresh = () => api.historyList().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);

  async function restore(id: string) {
    setConfirm(null);
    setState({ kind: "working", text: "Restoring…" });
    try {
      const r = await api.historyRestore(id);
      setState({ kind: "ok", text: `Restored ${r.restored} file${r.restored === 1 ? "" : "s"}${r.removed.length ? `, removed ${r.removed.length} created since` : ""}. The state before this restore is saved at the top — restore it to undo.` });
      onRestored([...r.files]);
      refresh();
    } catch (e) { setState({ kind: "error", text: (e as Error).message }); }
  }

  return (
    <div className="mem-panel history-panel" role="dialog" aria-label="History">
      <div className="mem-head"><b>History</b><span className="spacer" /><button className="icon-btn" onClick={onClose} aria-label="Close history">✕</button></div>
      <p className="muted small">V-Run saves a snapshot of your project before each task, at every finished step and after it — in its own store, never in your Git. Restore any point; the current state is saved first, so you can always come back.</p>
      {state.kind !== "idle" && <div className={`skill-state ${state.kind}`} role="status">{state.text}</div>}
      {list === null ? <p className="muted small">Loading…</p>
        : list.length === 0 ? <p className="muted small">No snapshots yet — they appear as soon as the agent works on this project (needs git installed).</p>
        : (
          <ul className="history-list">
            {list.map((h, i) => (
              <li key={h.id} className="history-item">
                <div className="history-text">
                  <span className="history-label">{h.label || "(snapshot)"}</span>
                  <span className="muted small">{ago(h.time)} · {h.files} file{h.files === 1 ? "" : "s"} changed{i === 0 ? " · latest" : ""}</span>
                </div>
                {confirm === h.id ? (
                  <span className="history-confirm">
                    <button className="btn small primary" disabled={busy} onClick={() => restore(h.id)}>Restore</button>
                    <button className="btn small" onClick={() => setConfirm(null)}>Cancel</button>
                  </span>
                ) : (
                  <button className="btn small" disabled={busy || state.kind === "working"} title={busy ? "Wait for the agent to finish" : "Put the project back to this point"} onClick={() => setConfirm(h.id)}>Restore…</button>
                )}
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
