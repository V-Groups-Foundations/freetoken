import { useEffect, useState } from "react";
import { api, type SkillInfo } from "./api";

/** Sections of the list: where each skill came from. */
const GROUPS: [string, (s: SkillInfo) => boolean][] = [
  ["Installed from GitHub", (s) => s.scope !== "builtin" && !!s.source],
  ["Learned by V-Run", (s) => s.scope === "user" && !s.source],
  ["This project", (s) => s.scope === "project" && !s.source],
  ["Built in", (s) => s.scope === "builtin"],
];

/**
 * What V-Run knows how to do: skills it learned, installed from GitHub, or ships with. The agent loads
 * one when a task matches; here you can see them, install more and remove what you don't want.
 */
export function SkillsPanel({ onClose, onPrefill, onAsk, busy }: {
  onClose: () => void; onPrefill: (text: string) => void; onAsk: (text: string) => void; busy: boolean;
}) {
  const [list, setList] = useState<SkillInfo[] | null>(null);
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "working" | "ok" | "error" | "readme"; text?: string; names?: string[] }>({ kind: "idle" });
  const refresh = () => api.skillsList().then(setList).catch(() => setList([]));
  useEffect(() => { refresh(); }, []);

  async function install() {
    const s = source.trim();
    if (!s) return;
    setState({ kind: "working", text: `Installing from ${s}…` });
    try {
      const r = await api.skillsInstall(s);
      if (r.installed.length) {
        setState({ kind: "ok", text: `Installed ${r.installed.map((x) => x.name).join(", ")} — active now. V-Run uses ${r.installed.length > 1 ? "them" : "it"} automatically whenever a request matches.` });
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
      <p className="muted small">Every skill here is active: V-Run picks the right one by itself when your request matches, and the chat shows which. Install more from any GitHub repo, or teach it new ones in the chat.</p>
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
      {list && list.length > 6 && (
        <input className="skill-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${list.length} skills…`} aria-label="Search skills" />
      )}
      <div className="skill-list">
        {!list && <div className="muted small">Loading…</div>}
        {list && GROUPS.map(([title, test]) => {
          const q = query.trim().toLowerCase();
          const rows = list.filter(test).filter((s) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q));
          if (!rows.length) return null;
          return (
            <section key={title} className="skill-group" aria-label={title}>
              <div className="skill-group-title">{title} <span>{rows.length}</span></div>
              {rows.map((s) => (
                <div key={`${s.scope}:${s.name}`} className="skill-row">
                  <div className="skill-main">
                    <div><b>{s.name}</b>{s.scope === "project" && <span className="skill-scope project"> this project</span>}</div>
                    <div className="muted small skill-desc" title={s.description}>{s.description || "No description"}</div>
                    {s.source && <div className="faint small">from {s.source}</div>}
                  </div>
                  {s.dir && <button className="btn small" onClick={() => api.skillsOpen(s.name)}>Open</button>}
                  {s.dir && s.scope !== "builtin" && <button className="icon-btn" onClick={() => remove(s.name)} aria-label={`Remove ${s.name}`} title="Remove">🗑</button>}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <button className="btn small" onClick={() => { onPrefill("Learn this as a skill: "); onClose(); }}>✦ Teach V-Run a new skill</button>
    </div>
  );
}
