import { useEffect, useRef, useState } from "react";
import { api, type TeamAgent, type TeamSnapshot } from "./api";

type LogLine = { kind: "tool" | "text" | "note" | "error"; text: string };
type Approval = { sid: string; id: string; command: string; explanation?: string };

const STATUS: Record<TeamAgent["status"], string> = { queued: "Queued", running: "Working", waiting: "Asking", done: "Done", failed: "Failed", stopped: "Stopped" };
const statusOf = (a: TeamAgent) => (a.reviewer && a.status === "running" ? "Reviewing" : a.reviewer && a.status === "done" ? (/\bAPPROVED\b/.test(a.report) ? "Approved" : "Changes needed") : STATUS[a.status]);

/**
 * Team mode: the supervisor's worker agents, live — what each is doing, the files it owns, its log and
 * report — plus their command approvals (auto-approved when the task was started with "Accept all").
 */
export function TeamPanel({ sid, autoApprove }: { sid: string; autoApprove: () => boolean }) {
  const [snap, setSnap] = useState<TeamSnapshot>({ supervisor: sid, agents: [] });
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const sids = useRef(new Set<string>());
  const auto = useRef(autoApprove);
  auto.current = autoApprove;

  useEffect(() => {
    setSnap({ supervisor: sid, agents: [] }); setLogs({}); setApprovals([]);
    api.teamSnapshot(sid).then((s) => { sids.current = new Set(s.agents.map((a) => a.sid)); setSnap(s); }).catch(() => {});
    const a = api.onTeamEvent((s) => {
      if (s.supervisor !== sid) return;
      sids.current = new Set(s.agents.map((x) => x.sid));
      setSnap(s);
    });
    const b = api.onAgentEvent(({ sessionId, event: e }) => {
      if (!sids.current.has(sessionId)) return;
      const add = (line: LogLine) => setLogs((l) => {
        const list = [...(l[sessionId] ?? [])];
        if (line.kind === "text" && list[list.length - 1]?.kind === "text") list[list.length - 1] = { kind: "text", text: list[list.length - 1].text + line.text };
        else list.push(line);
        return { ...l, [sessionId]: list.slice(-60) };
      });
      if (e.type === "text") add({ kind: "text", text: e.delta });
      else if (e.type === "tool_end") add({ kind: "tool", text: e.summary });
      else if (e.type === "error") add({ kind: "error", text: e.message });
      else if (e.type === "approval") {
        if (auto.current()) { api.approve(sessionId, e.id, true); add({ kind: "note", text: `Auto-approved: ${e.command}` }); }
        else setApprovals((p) => [...p, { sid: sessionId, id: e.id, command: e.command, explanation: e.explanation }]);
      } else if (e.type === "done") setApprovals((p) => p.filter((x) => x.sid !== sessionId));
    });
    return () => { a(); b(); };
  }, [sid]);

  if (!snap.agents.length) return null;
  const working = snap.agents.filter((a) => a.status === "running" || a.status === "waiting" || a.status === "queued").length;
  const decide = (x: Approval, ok: boolean) => { api.approve(x.sid, x.id, ok); setApprovals((p) => p.filter((y) => y !== x)); };
  const nameOf = (s: string) => snap.agents.find((a) => a.sid === s)?.name ?? s;

  return (
    <div className="team-panel" role="region" aria-label="Team">
      <div className="team-head">
        <button className="team-toggle" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
          <span className="team-glyph" aria-hidden>⧉</span> Team <span className="muted">· {snap.agents.length} agent{snap.agents.length > 1 ? "s" : ""}{working ? ` · ${working} working` : " · all finished"}</span>
          <span className="chev">{collapsed ? "▸" : "▾"}</span>
        </button>
        <span className="spacer" />
        {working > 0 && <button className="btn small" onClick={() => api.teamStop(sid)}>Stop all</button>}
      </div>
      {approvals.map((x) => (
        <div key={x.id} className="team-approval">
          <div><b>{nameOf(x.sid)}</b> wants to run <code>{x.command}</code>{x.explanation ? <span className="muted"> — {x.explanation}</span> : null}</div>
          <div className="team-approval-btns"><button className="btn primary small" onClick={() => decide(x, true)}>Allow</button><button className="btn small" onClick={() => decide(x, false)}>Skip</button></div>
        </div>
      ))}
      {!collapsed && (
        <div className="team-list">
          {snap.agents.map((a) => (
            <div key={a.sid} className={`team-agent ${a.status}`}>
              <button className="team-row" onClick={() => setOpen((o) => (o === a.sid ? null : a.sid))} aria-expanded={open === a.sid}>
                <span className={`team-dot ${a.status}`} aria-hidden />
                <b className="team-name">{a.reviewer ? "🔍 " : ""}{a.name}</b>
                <span className="team-status">{statusOf(a)}</span>
                <span className="team-activity" title={a.activity}>{a.question ? `❓ ${a.question}` : a.activity}</span>
                {a.files.length > 0 && <span className="team-files" title={a.files.join("\n")}>🔒 {a.files.length}</span>}
              </button>
              {open === a.sid && (
                <div className="team-detail">
                  <div className="muted small team-task">{a.task}</div>
                  {a.files.length > 0 && <div className="small">Owns: {a.files.map((f) => <code key={f}>{f}</code>)}</div>}
                  <div className="team-log">
                    {(logs[a.sid] ?? []).map((l, i) => <div key={i} className={`team-log-${l.kind}`}>{l.kind === "tool" ? "▸ " : ""}{l.text.trim().slice(0, 400)}</div>)}
                    {!(logs[a.sid] ?? []).length && <div className="muted small">No activity yet.</div>}
                  </div>
                  {a.report && (a.status === "done" || a.status === "failed" || a.status === "stopped") && <div className="team-report"><b>Report</b><div>{a.report}</div></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
