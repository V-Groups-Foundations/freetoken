import { useEffect, useState } from "react";
import { api, type SkillInfo } from "./api";

const SCOPE: Record<SkillInfo["scope"], string> = { project: "This project", user: "Yours", builtin: "Built in" };

/**
 * What V-Run knows how to do: skills it learned, installed from GitHub, or ships with. The agent loads
 * one when a task matches; here you can see them, install more and remove what you don't want.
 */
export function SkillsPanel({ onClose, onPrefill, onAsk, busy }: {
  onClose: () => void; onPrefill: (text: string) => void; onAsk: (text: string) => void; busy: boolean;
}) {
  const [list, setList] = useState<SkillInfo[] | null>(null);
  const [source, setSource] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "working" | "ok" | "error" | "readme"; text?: string }>({ kind: "idle" });
  const refresh = () => api.skillsList().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);

  async function install() {
    const s = source.trim();
    if (!s) return;
    setState({ kind: "working", text: `Installing from ${s}…` });
    try {
      const r = await api.skillsInstall(s);
      if (r.installed.length) {
        setState({ kind: "ok", text: `Installed ${r.installed.map((x) => x.name).join(", ")}` });
        setSource("");
      } else setState({ kind: "readme", text: r.source });
      refresh();
    } catch (e) { setState({ kind: "error", text: (e as Error).message }); }
  }
  async function remove(name: string) {
    try { await api.skillsRemove(name); refresh(); } catch (e) { setState({ kind: "error", text: (e as Error).message }); }
  }

  return (
    <div className="mem-panel skills-panel" role="dialog" aria-label="Skills">
      <div className="mem-head"><b>Skills</b><span className="spacer" /><button className="icon-btn" onClick={onClose} aria-label="Close skills">✕</button></div>
      <p className="muted small">Know-how V-Run loads when a task needs it. Teach it one in the chat, or install skills from any GitHub repo.</p>
      <form className="skill-install" onSubmit={(e) => { e.preventDefault(); install(); }}>
        <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="owner/repo or github.com link — e.g. anthropics/skills" aria-label="GitHub repository" />
        <button className="btn primary small" disabled={!source.trim() || state.kind === "working"}>Install</button>
      </form>
      {state.kind !== "idle" && (
        <div className={`skill-state ${state.kind}`} role="status">
          {state.kind === "readme" ? (
            <>{state.text} has no skills yet. <button className="link-btn" disabled={busy} onClick={() => { onAsk(`Learn ${state.text} as a skill: install_skills it, then write the skill from its README.`); onClose(); }}>Let the agent learn it from the README →</button></>
          ) : state.text}
        </div>
      )}
      <div className="skill-list">
        {!list && <div className="muted small">Loading…</div>}
        {list?.map((s) => (
          <div key={`${s.scope}:${s.name}`} className="skill-row">
            <div className="skill-main">
              <div><b>{s.name}</b> <span className={`skill-scope ${s.scope}`}>{SCOPE[s.scope]}</span></div>
              <div className="muted small skill-desc" title={s.description}>{s.description || "No description"}</div>
              {s.source && <div className="faint small">from {s.source}</div>}
            </div>
            {s.dir && <button className="btn small" onClick={() => api.skillsOpen(s.name)}>Open</button>}
            {s.dir && <button className="icon-btn" onClick={() => remove(s.name)} aria-label={`Remove ${s.name}`} title="Remove">🗑</button>}
          </div>
        ))}
      </div>
      <button className="btn small" onClick={() => { onPrefill("Learn this as a skill: "); onClose(); }}>✦ Teach V-Run a new skill</button>
    </div>
  );
}
