// Source control: what changed since the last commit, a diff per file, stage / unstage / discard,
// commit, and branches — the git a project needs day to day, without leaving V-Run.
import { useCallback, useEffect, useState } from "react";
import { api, type GitFile, type GitStatus } from "./api";

const LABEL: Record<string, string> = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", U: "conflict", "?": "new" };
const letter = (f: GitFile, staged: boolean) => (staged ? f.staged : f.untracked ? "U" : f.unstaged);

export function SourceControl({ version, onDiff, onChanged, onToast }: { version: number; onDiff: (path: string) => void; onChanged: (paths: string[]) => void; onToast: (m: string) => void }) {
  const [st, setSt] = useState<GitStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const [log, setLog] = useState<{ hash: string; when: string; subject: string }[]>([]);

  const refresh = useCallback(async () => {
    try {
      const s = await api.gitStatus();
      setSt(s);
      if (s.repo) { setBranches((await api.gitBranches()).all); setLog(await api.gitLog(8)); }
    } catch (e) { onToast((e as Error).message); }
  }, [onToast]);
  useEffect(() => { refresh(); }, [refresh, version]);
  useEffect(() => { const t = setInterval(refresh, 4000); return () => clearInterval(t); }, [refresh]); // the agent and the terminal change files too

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try { await fn(); if (done) onToast(done); } catch (e) { onToast((e as Error).message); }
    finally { setBusy(false); refresh(); }
  }

  if (!st) return <div className="git-panel muted small">Reading git…</div>;
  if (!st.repo) return (
    <div className="git-panel">
      <div className="side-title">SOURCE CONTROL</div>
      <p className="muted small">This folder isn't a git repository.</p>
      <button className="btn" disabled={busy} onClick={() => run(() => api.gitInit(), "Started a git repository")}>Initialize repository</button>
    </div>
  );
  const staged = st.files.filter((f) => f.staged !== "." && !f.untracked);
  const changes = st.files.filter((f) => f.unstaged !== "." || f.untracked);
  const row = (f: GitFile, isStaged: boolean) => {
    const l = letter(f, isStaged);
    return (
      <div key={`${isStaged ? "s" : "w"}:${f.path}`} className="git-file">
        <button className="linklike git-name" onClick={() => onDiff(f.path)} title={`${f.path} — ${LABEL[l] ?? l}. Click to see the changes`}>
          <span className="git-base">{f.path.split("/").pop()}</span> <span className="muted small">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
        </button>
        <span className="git-acts">
          {isStaged
            ? <button className="icon-btn" disabled={busy} title="Unstage" aria-label={`Unstage ${f.path}`} onClick={() => run(() => api.gitUnstage([f.path]))}>−</button>
            : <>
                {confirmDiscard === f.path
                  ? <button className="icon-btn danger" disabled={busy} title="Click again to throw these changes away" aria-label={`Confirm discard ${f.path}`} onClick={() => { setConfirmDiscard(null); run(async () => { await api.gitDiscard(f.path, f.untracked); onChanged([f.path]); }, `Discarded ${f.path}`); }}>✓?</button>
                  : <button className="icon-btn" disabled={busy} title={f.untracked ? "Delete this new file" : "Discard changes (back to the last commit)"} aria-label={`Discard ${f.path}`} onClick={() => setConfirmDiscard(f.path)}>↶</button>}
                <button className="icon-btn" disabled={busy} title="Stage" aria-label={`Stage ${f.path}`} onClick={() => run(() => api.gitStage([f.path]))}>+</button>
              </>}
          <span className={`git-letter git-${l}`} title={LABEL[l] ?? l}>{l}</span>
        </span>
      </div>
    );
  };
  return (
    <div className="git-panel" aria-label="Source control">
      <div className="side-title">SOURCE CONTROL</div>
      <div className="git-branch">
        <select className="field" aria-label="Branch" value={st.branch} disabled={busy} onChange={(e) => run(() => api.gitCheckout(e.target.value, false), `Switched to ${e.target.value}`)}>
          {[...new Set([st.branch, ...branches])].map((b) => <option key={b} value={b}>⑂ {b}</option>)}
        </select>
        {(st.ahead > 0 || st.behind > 0) && <span className="muted small" title={`compared with ${st.upstream}`}>↑{st.ahead} ↓{st.behind}</span>}
      </div>
      <textarea className="field git-msg" aria-label="Commit message" rows={2} placeholder="Commit message (Ctrl+Enter to commit)" value={msg}
        onChange={(e) => setMsg(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey && msg.trim()) { e.preventDefault(); run(async () => { await api.gitCommit(msg, !staged.length); setMsg(""); }, "Committed"); } }} />
      <button className="btn primary" disabled={busy || !msg.trim() || !st.files.length} onClick={() => run(async () => { const c = await api.gitCommit(msg, !staged.length); setMsg(""); onToast(`Committed ${c}`); })}
        title={staged.length ? "Commit the staged changes" : "Nothing staged: commit all changes"}>
        ✓ Commit{staged.length ? ` ${staged.length} staged` : st.files.length ? " all" : ""}
      </button>
      {staged.length > 0 && <>
        <div className="git-group">STAGED CHANGES <span className="muted">{staged.length}</span></div>
        {staged.map((f) => row(f, true))}
      </>}
      <div className="git-group">
        CHANGES <span className="muted">{changes.length}</span>
        {changes.length > 0 && <button className="linklike small" disabled={busy} onClick={() => run(() => api.gitStage(changes.map((f) => f.path)))}>Stage all</button>}
      </div>
      {changes.length ? changes.map((f) => row(f, false)) : <p className="muted small">No changes since the last commit.</p>}
      <div className="git-group">BRANCH</div>
      <form className="git-new" onSubmit={(e) => { e.preventDefault(); if (newBranch.trim()) run(async () => { await api.gitCheckout(newBranch.trim(), true); setNewBranch(""); }, `Created ${newBranch.trim()}`); }}>
        <input className="field" aria-label="New branch name" placeholder="new-branch-name" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
        <button className="btn" disabled={busy || !newBranch.trim()}>Create</button>
      </form>
      {log.length > 0 && <>
        <div className="git-group">RECENT COMMITS</div>
        {log.map((c) => <div key={c.hash} className="git-commit small" title={c.subject}><code>{c.hash}</code> {c.subject} <span className="muted">· {c.when}</span></div>)}
      </>}
    </div>
  );
}
