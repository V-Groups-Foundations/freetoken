// Team mode: a supervisor agent runs worker agents in parallel, each on its own task, and a file
// coordinator keeps them from stepping on each other:
//   - ownership: a file belongs to the agent assigned it (or the first to change it); other agents'
//     edits to it are refused and they're told to ask the supervisor;
//   - change notices: when an agent changes a file other agents have read, each of them is told
//     who changed it and how, with their next tool result;
//   - no stale edits: an agent can't edit a file that changed (by another agent) since it last read it.
// Workers can't start agents (one level of hierarchy); questions go up with ask_supervisor and wake the
// supervisor's wait_for_agents. Everything here is in memory, per supervisor chat; main.ts saves it
// (exportTeam / importTeam) so a team survives a restart.
import type { AgentEvent, ChatRequest, Session } from "./ai";

export const MAX_RUNNING = 4;
const MAX_AGENTS = 8;
const ASK_TIMEOUT_MS = 15 * 60_000;

type Status = "queued" | "running" | "waiting" | "done" | "failed" | "stopped";
interface Worker {
  sid: string; name: string; task: string; files: string[];
  status: Status; activity: string; report: string; text: string;
  started: number; ended?: number; runs: number;
  question?: { text: string; resolve: (answer: string) => void };
  pendingRun?: string;
  /** the reviewer: reads and runs checks, never edits; started automatically when the agents finish */
  reviewer?: boolean;
  /** the model it's working with right now */
  model?: string;
}
export const REVIEWER = "reviewer";
const MAX_REVIEWS = 2;
interface Team {
  supervisor: string;
  workers: Map<string, Worker>;
  inbox: string[];
  wake: Set<() => void>;
  // file coordination, shared by everyone in the team
  claims: Map<string, string>;                       // path → session id that owns it
  versions: Map<string, { n: number; by: string }>;  // bumped on every agent write
  reads: Map<string, Map<string, number>>;           // session id → path → version it last read
  notices: Map<string, string[]>;                    // session id → messages for its next tool result
  // review: files changed since the last review, and how many reviews this job has had
  changedSinceReview: Set<string>;
  reviews: number;
}

export interface TeamDeps {
  run(req: ChatRequest, emit: (e: AgentEvent) => void): Promise<unknown>;
  stop(sessionId: string): void;
  getSession(sessionId: string): Session;
  forward(sessionId: string, e: AgentEvent): void;
  onTeam(supervisor: string, snapshot: TeamSnapshot): void;
}
export type TeamSnapshot = { supervisor: string; agents: { sid: string; name: string; task: string; status: Status; activity: string; files: string[]; report: string; question?: string; reviewer?: boolean; model?: string }[] };

let deps: TeamDeps | null = null;
export const configureTeam = (d: TeamDeps) => { deps = d; };

const teams = new Map<string, Team>();
const memberOf = new Map<string, { team: Team; name: string }>();

const key = (name: string) => name.trim().toLowerCase();
export const workerSid = (supervisor: string, name: string) => `${supervisor}::${key(name).replace(/[^a-z0-9-]+/g, "-")}`;
const active = (w?: Worker) => !!w && (w.status === "running" || w.status === "waiting" || w.status === "queued");

function teamOf(supervisor: string) {
  let t = teams.get(supervisor);
  if (!t) {
    t = { supervisor, workers: new Map(), inbox: [], wake: new Set(), claims: new Map(), versions: new Map(), reads: new Map(), notices: new Map(), changedSinceReview: new Set(), reviews: 0 };
    teams.set(supervisor, t);
    memberOf.set(supervisor, { team: t, name: "supervisor" });
  }
  return t;
}
const nameOf = (t: Team, sid: string) => (sid === t.supervisor ? "the supervisor" : `agent "${[...t.workers.values()].find((w) => w.sid === sid)?.name ?? sid}"`);
const ownerActive = (t: Team, sid: string) => sid === t.supervisor || active([...t.workers.values()].find((w) => w.sid === sid));

function wakeAll(t: Team) { for (const f of [...t.wake]) f(); t.wake.clear(); }
function publish(t: Team) { deps?.onTeam(t.supervisor, snapshot(t.supervisor)); }
function notify(t: Team, sid: string, text: string) {
  const list = t.notices.get(sid) ?? [];
  list.push(text);
  t.notices.set(sid, list);
}

export function snapshot(supervisor: string): TeamSnapshot {
  const t = teams.get(supervisor);
  if (!t) return { supervisor, agents: [] };
  return {
    supervisor,
    agents: [...t.workers.values()].map((w) => ({
      sid: w.sid, name: w.name, task: w.task, status: w.status, activity: w.activity, report: w.report, ...(w.reviewer ? { reviewer: true } : {}),
      files: [...t.claims].filter(([, s]) => s === w.sid).map(([p]) => p), ...(w.question ? { question: w.question.text } : {}), ...(w.model ? { model: w.model } : {}),
    })),
  };
}

/** Is this session part of a team (a supervisor with workers, or a worker)? */
/** Has this supervisor started any agents? */
export const hasAgents = (supervisor: string) => (teams.get(supervisor)?.workers.size ?? 0) > 0;
export const inTeam = (sid: string) => { const m = memberOf.get(sid); return !!m && (m.name !== "supervisor" || m.team.workers.size > 0); };
export const workerInfo = (sid: string) => {
  const m = memberOf.get(sid);
  if (!m || m.name === "supervisor") return null;
  const w = m.team.workers.get(key(m.name))!;
  const others = [...m.team.workers.values()].filter((o) => o !== w).map((o) => `- ${o.name} (${o.status}): ${o.task.split("\n")[0].slice(0, 160)}`);
  return { name: w.name, task: w.task, files: w.files, others };
};

// ---------------------------------------------------------------- file coordination (called by execTool)

/** Before an edit/write/delete: null when allowed, otherwise why not (sent back to the agent). */
export function guardWrite(sid: string, rel: string, exists: boolean): string | null {
  const m = memberOf.get(sid);
  if (!m || !inTeam(sid)) return null;
  const t = m.team;
  const owner = t.claims.get(rel);
  if (owner && owner !== sid && ownerActive(t, owner) && owner !== t.supervisor) {
    return `🔒 ${rel} belongs to ${nameOf(t, owner)}, which is working on it now. Don't change it. ${m.name === "supervisor"
      ? "Wait for that agent (wait_for_agents), message it (message_agent), or take the file over with assign_file."
      : "If you need a change there, ask_supervisor (say exactly what you need), and carry on with the rest of your task meanwhile."}`;
  }
  const v = t.versions.get(rel);
  const seen = t.reads.get(sid)?.get(rel);
  if (v && v.by !== sid && exists && (seen === undefined || seen < v.n)) {
    return `⚠ ${rel} was changed by ${nameOf(t, v.by)} ${seen === undefined ? "and you haven't read it" : "after you last read it"}. Read it again (read_file) and make your change on top of the current version.`;
  }
  return null;
}

export function noteRead(sid: string, rel: string) {
  const m = memberOf.get(sid);
  if (!m) return;
  const reads = m.team.reads.get(sid) ?? new Map<string, number>();
  reads.set(rel, m.team.versions.get(rel)?.n ?? 0);
  m.team.reads.set(sid, reads);
}

/** After an agent changed a file: it owns it now (unless someone does), and readers are told. */
export function noteWrite(sid: string, rel: string, summary: string) {
  const m = memberOf.get(sid);
  if (!m || !inTeam(sid)) return;
  const t = m.team;
  const n = (t.versions.get(rel)?.n ?? 0) + 1;
  t.versions.set(rel, { n, by: sid });
  t.changedSinceReview.add(rel);
  const mine = t.reads.get(sid) ?? new Map<string, number>();
  mine.set(rel, n);
  t.reads.set(sid, mine);
  if (!t.claims.has(rel) || !ownerActive(t, t.claims.get(rel)!)) t.claims.set(rel, sid);
  for (const [other, reads] of t.reads) {
    if (other === sid || !reads.has(rel) || !ownerActive(t, other)) continue;
    notify(t, other, `⚠ ${nameOf(t, sid)} changed ${rel} after you read it (${summary}). Read it again before you rely on or edit it.`);
  }
  publish(t);
}

/** Messages for this agent, to append to its next tool result. */
export function takeNotices(sid: string) {
  const m = memberOf.get(sid);
  const list = m?.team.notices.get(sid);
  if (!list?.length) return "";
  m!.team.notices.delete(sid);
  return `\n\n[Team] ${list.join("\n[Team] ")}`;
}

export function noteActivity(sid: string, text: string) {
  const m = memberOf.get(sid);
  if (!m || m.name === "supervisor") return;
  const w = m.team.workers.get(key(m.name));
  if (w) { w.activity = text.slice(0, 140); publish(m.team); }
}

// ---------------------------------------------------------------- running workers

function release(t: Team, sid: string) { for (const [p, s] of [...t.claims]) if (s === sid) t.claims.delete(p); }

/** Move a finished worker's file checkpoints into the supervisor's session, so one review covers the team. */
function mergeCheckpoints(t: Team, w: Worker) {
  if (!deps) return;
  const from = deps.getSession(w.sid), to = deps.getSession(t.supervisor);
  for (const [rel, original] of from.checkpoints) if (!to.checkpoints.has(rel)) to.checkpoints.set(rel, original);
  const turn = to.turns[to.turns.length - 1];
  if (turn) for (const [rel, original] of from.checkpoints) if (!turn.files.has(rel)) turn.files.set(rel, original);
  from.checkpoints.clear();
}

function startQueued(t: Team) {
  for (const w of t.workers.values()) {
    if ([...t.workers.values()].filter((x) => x.status === "running" || x.status === "waiting").length >= MAX_RUNNING) break;
    if (w.status === "queued" && w.pendingRun !== undefined) { const text = w.pendingRun; w.pendingRun = undefined; run(t, w, text); }
  }
}

function run(t: Team, w: Worker, text: string) {
  if (!deps) throw new Error("Team mode isn't available here.");
  const running = [...t.workers.values()].filter((x) => x.status === "running" || x.status === "waiting").length;
  if (running >= MAX_RUNNING) { w.status = "queued"; w.pendingRun = text; w.activity = "Waiting for a free slot"; publish(t); return; }
  w.status = "running"; w.runs++; w.text = ""; w.activity = "Starting"; w.started = Date.now(); w.ended = undefined;
  publish(t);
  const emit = (e: AgentEvent) => {
    deps!.forward(w.sid, e);
    if (e.type === "text") w.text += e.delta;
    else if (e.type === "tool_start") { w.text = ""; w.activity = `${e.name}${(e.input as any)?.path ? ` ${(e.input as any).path}` : (e.input as any)?.command ? `: ${String((e.input as any).command).slice(0, 80)}` : ""}`; publish(t); }
    else if (e.type === "tool_end") { w.activity = e.summary; publish(t); }
    else if (e.type === "model") { w.model = e.model; publish(t); }
    else if (e.type === "approval") { w.activity = `Needs approval: ${e.command}`; publish(t); }
    else if (e.type === "error") w.report = `Error: ${e.message}`;
    else if (e.type === "done") {
      w.ended = Date.now();
      const stopped = e.stopReason === "aborted";
      w.status = stopped ? "stopped" : e.stopReason === "error" ? "failed" : "done";
      w.report = (w.text.trim() || w.report || (stopped ? "Stopped before finishing." : "(no report)")).slice(-6000);
      w.activity = w.status === "done" ? "Finished" : w.status === "stopped" ? "Stopped" : "Failed";
      if (w.question) { w.question.resolve("(you were stopped)"); w.question = undefined; }
      release(t, w.sid);
      mergeCheckpoints(t, w);
      t.inbox.push(`${w.name} ${w.status === "done" ? "finished" : w.status}.`);
      publish(t);
      wakeAll(t);
      startQueued(t);
    }
  };
  deps.run({ sessionId: w.sid, mode: "agent", text, worker: { name: w.name, supervisor: t.supervisor, ...(w.reviewer ? { reviewer: true } : {}) } }, emit)
    .catch((err) => emit({ type: "error", message: String((err as Error)?.message ?? err) }));
}

const brief = (w: Worker) =>
  `${w.task}${w.files.length ? `\n\nFiles assigned to you: ${w.files.join(", ")}` : ""}\n\nWhen you're done, reply with a short report for the supervisor: what you changed (paths), how you verified it, and anything the others need to know (APIs, names, open issues).`;

// ---------------------------------------------------------------- supervisor tools

export function spawn(supervisor: string, input: { name: string; task: string; files?: string[] }, normalize: (p: string) => string) {
  const t = teamOf(supervisor);
  const name = input.name.trim().slice(0, 32);
  if (!/^[\w][\w -]*$/.test(name)) throw new Error("Give the agent a short name (letters, digits, dashes), e.g. frontend.");
  const existing = t.workers.get(key(name));
  if (key(name) === REVIEWER) throw new Error("\"reviewer\" is reserved — a reviewer checks the work automatically when the agents finish. Give this agent a role name like frontend or api.");
  if (existing && active(existing)) throw new Error(`An agent named ${name} is already working. Pick another name, or message_agent it.`);
  if (!existing && t.workers.size >= MAX_AGENTS) throw new Error(`A team can have at most ${MAX_AGENTS} agents; reuse one with message_agent.`);
  const files = (input.files ?? []).map(normalize);
  const sid = workerSid(supervisor, name);
  // "front end" and "front-end" would share one session (two agents writing one transcript)
  const clash = [...t.workers.values()].find((w) => w.sid === sid && key(w.name) !== key(name));
  if (clash) throw new Error(`"${name}" is too close to the existing agent "${clash.name}" — give it a clearly different name.`);
  const taken = files.filter((f) => { const o = t.claims.get(f); return o && o !== sid && o !== supervisor && ownerActive(t, o); });
  if (taken.length) throw new Error(`Already owned by other agents: ${taken.map((f) => `${f} (${nameOf(t, t.claims.get(f)!)})`).join(", ")}. Give each agent different files.`);
  const w: Worker = existing ?? { sid, name, task: input.task, files, status: "queued", activity: "", report: "", text: "", started: Date.now(), runs: 0 };
  w.task = input.task; w.files = files; w.report = "";
  t.workers.set(key(name), w);
  memberOf.set(sid, { team: t, name });
  for (const f of files) t.claims.set(f, sid);
  run(t, w, brief(w));
  const queued = w.status === "queued";
  return `Started agent "${name}"${queued ? ` (queued — at most ${MAX_RUNNING} run at once)` : ""}${files.length ? `, owning ${files.join(", ")}` : ""}. It works in parallel; use wait_for_agents to get its report.`;
}

export function statusText(supervisor: string) {
  const t = teams.get(supervisor);
  if (!t?.workers.size) return "No agents yet. Start some with spawn_agent.";
  const lines = [...t.workers.values()].map((w) => {
    const owned = [...t.claims].filter(([, s]) => s === w.sid).map(([p]) => p);
    const secs = Math.round(((w.ended ?? Date.now()) - w.started) / 1000);
    return `- ${w.name} [${w.status}, ${secs}s] ${w.activity}${owned.length ? ` · owns ${owned.slice(0, 8).join(", ")}${owned.length > 8 ? "…" : ""}` : ""}${w.question ? `\n  ❓ asks: ${w.question.text}` : ""}${w.status === "done" || w.status === "failed" ? `\n  report: ${w.report.replace(/\s+/g, " ").slice(0, 400)}` : ""}`;
  });
  return `Agents:\n${lines.join("\n")}`;
}

/** Start (or restart) the reviewer on what changed since the last review; returns it. */
function startReview(t: Team) {
  const changed = [...t.changedSinceReview].sort();
  t.changedSinceReview.clear();
  t.reviews++;
  const builders = [...t.workers.values()].filter((w) => !w.reviewer);
  const task = [
    `Review the team's work (review ${t.reviews} of at most ${MAX_REVIEWS}).`,
    "",
    "What each agent was asked to do, and what it reported:",
    ...builders.map((w) => `### ${w.name}\nTask: ${w.task.split("\n").slice(0, 12).join("\n")}\nReport: ${(w.report || "(none)").replace(/\s+/g, " ").slice(0, 1200)}`),
    "",
    `Files changed since the last review:\n${changed.map((f) => `- ${f} (owner: ${(() => { const o = t.claims.get(f) ?? t.versions.get(f)?.by; const w = builders.find((x) => x.sid === o); return w ? w.name : "supervisor"; })()})`).join("\n")}`,
  ].join("\n");
  const sid = workerSid(t.supervisor, REVIEWER);
  const w: Worker = t.workers.get(REVIEWER) ?? { sid, name: REVIEWER, task: "", files: [], status: "queued", activity: "", report: "", text: "", started: Date.now(), runs: 0, reviewer: true };
  w.task = task; w.report = ""; w.reviewer = true;
  t.workers.set(REVIEWER, w);
  memberOf.set(sid, { team: t, name: REVIEWER });
  run(t, w, task);
  return w;
}

/** Wait until the named agents (default: all) finish, one of them asks something, or the timeout. */
export async function waitFor(supervisor: string, names: string[] | undefined, timeoutSec: number, signal?: AbortSignal) {
  const t = teams.get(supervisor);
  if (!t?.workers.size) return "No agents to wait for.";
  const targets = names?.length ? names.map((n) => t.workers.get(key(n))).filter((w): w is Worker => !!w) : [...t.workers.values()];
  if (!targets.length) return `No agents named ${names!.join(", ")}. ${statusText(supervisor)}`;
  const deadline = Date.now() + Math.max(5, Math.min(1800, timeoutSec)) * 1000;
  t.inbox.length = 0; // only news from now on
  for (;;) {
    const questions = [...t.workers.values()].filter((w) => w.question);
    if (questions.length) return `${questions.map((w) => `❓ ${w.name} asks: ${w.question!.text}`).join("\n")}\nAnswer with message_agent (it's waiting), then wait again.\n\n${statusText(supervisor)}`;
    if (targets.every((w) => !active(w))) {
      // the agents are done: a reviewer checks their work before the supervisor wraps up
      const builders = [...t.workers.values()].filter((w) => !w.reviewer);
      if (builders.every((w) => !active(w)) && t.changedSinceReview.size && t.reviews < MAX_REVIEWS && !targets.some((w) => w.reviewer && active(w))) {
        const reviewer = startReview(t);
        if (reviewer && !targets.includes(reviewer)) targets.push(reviewer);
        continue;
      }
      const reports = targets.map((w) => `## ${w.name}${w.reviewer ? " (review)" : ""} — ${w.status}\n${w.report || "(no report)"}`).join("\n\n");
      const review = targets.find((w) => w.reviewer && w.status === "done");
      const next = !review ? ""
        : /\bAPPROVED\b/.test(review.report) ? "\n\nThe reviewer approved the work. Run the app or tests yourself once more, then give the user your final answer."
        : t.reviews >= MAX_REVIEWS ? "\n\nThis was the last automatic review. Fix what's left (message the owning agent, or do it yourself), verify, then answer the user — mention anything still open."
        : "\n\nThe reviewer found issues. Send each fix to the agent that owns the file (message_agent), then wait_for_agents again — another review follows automatically.";
      return reports + next;
    }
    if (signal?.aborted) return "Stopped waiting.";
    if (Date.now() >= deadline) return `Still working after ${timeoutSec}s.\n\n${statusText(supervisor)}`;
    await new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); t.wake.delete(done); resolve(); };
      const timer = setTimeout(done, Math.min(15_000, deadline - Date.now()));
      signal?.addEventListener("abort", done);
      t.wake.add(done);
    });
  }
}

export function message(supervisor: string, name: string, text: string) {
  const t = teams.get(supervisor);
  const w = t?.workers.get(key(name));
  if (!t || !w) throw new Error(`No agent named ${name}.`);
  if (w.question) { const q = w.question; w.question = undefined; w.status = "running"; q.resolve(text); publish(t); return `Answered ${w.name}; it carries on.`; }
  if (active(w)) { notify(t, w.sid, `Message from the supervisor: ${text}`); return `${w.name} gets your message with its next step.`; }
  run(t, w, `Message from the supervisor (continue your work on this): ${text}`);
  return `${w.name} had finished; it's working on your message now.`;
}

export function stopAgent(supervisor: string, name?: string) {
  const t = teams.get(supervisor);
  if (!t) return "No agents.";
  const list = name ? [t.workers.get(key(name))].filter((w): w is Worker => !!w) : [...t.workers.values()];
  for (const w of list) {
    if (w.status === "queued") { w.status = "stopped"; w.pendingRun = undefined; w.activity = "Stopped"; continue; }
    if (active(w)) { if (w.question) { w.question.resolve("(stopped)"); w.question = undefined; } deps?.stop(w.sid); }
  }
  publish(t);
  return name ? `Stopping ${name}.` : "Stopping all agents.";
}

export function assign(supervisor: string, rel: string, to: string) {
  const t = teams.get(supervisor);
  if (!t) throw new Error("No team yet.");
  if (["supervisor", "me", "you"].includes(key(to))) { t.claims.set(rel, supervisor); publish(t); return `You own ${rel} now.`; }
  const w = t.workers.get(key(to));
  if (!w) throw new Error(`No agent named ${to}.`);
  t.claims.set(rel, w.sid);
  notify(t, w.sid, `The supervisor gave you ${rel} — you may edit it now (read it first).`);
  publish(t);
  return `${w.name} owns ${rel} now.`;
}

/** A worker's question: it waits here until the supervisor answers (message_agent). */
export function ask(workerSid: string, question: string, signal?: AbortSignal) {
  const m = memberOf.get(workerSid);
  if (!m || m.name === "supervisor") throw new Error("Only team agents can ask the supervisor.");
  const t = m.team, w = t.workers.get(key(m.name))!;
  return new Promise<string>((resolve) => {
    const timer = setTimeout(() => finish("The supervisor didn't answer in time — use your best judgment and mention it in your report."), ASK_TIMEOUT_MS);
    const finish = (answer: string) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); if (w.status === "waiting") w.status = "running"; publish(t); resolve(answer); };
    const onAbort = () => { w.question = undefined; finish("(stopped)"); };
    signal?.addEventListener("abort", onAbort);
    w.question = { text: question, resolve: finish };
    w.status = "waiting";
    w.activity = `Asked: ${question.slice(0, 100)}`;
    t.inbox.push(`${w.name} asks: ${question}`);
    publish(t);
    wakeAll(t);
  });
}

/** For tests: forget every team. */
export function resetTeams() { teams.clear(); memberOf.clear(); }

// ---------------------------------------------------------------- surviving a restart

/** What's kept of a team when V-Run closes: who the agents are, what they did, who owns which file. */
export interface SavedTeam {
  agents: { name: string; task: string; files: string[]; status: Status; report: string; runs: number; reviewer?: boolean }[];
  claims: [string, string][]; // path → agent name ("supervisor" for the supervisor)
  changedSinceReview: string[];
  reviews: number;
}

export function exportTeam(supervisor: string): SavedTeam | null {
  const t = teams.get(supervisor);
  if (!t?.workers.size) return null;
  const names = new Map([...t.workers.values()].map((w) => [w.sid, w.name]));
  return {
    agents: [...t.workers.values()].map((w) => ({ name: w.name, task: w.task, files: w.files, status: w.status, report: w.report, runs: w.runs, ...(w.reviewer ? { reviewer: true } : {}) })),
    claims: [...t.claims].map(([p, sid]) => [p, sid === supervisor ? "supervisor" : names.get(sid) ?? ""] as [string, string]).filter(([, n]) => n),
    changedSinceReview: [...t.changedSinceReview],
    reviews: t.reviews,
  };
}

/** Bring a saved team back (after a restart): agents that were mid-task show as stopped, ready for message_agent. */
export function importTeam(supervisor: string, saved: SavedTeam) {
  if (teams.get(supervisor)?.workers.size || !saved?.agents?.length) return false;
  const t = teamOf(supervisor);
  for (const a of saved.agents) {
    const sid = workerSid(supervisor, a.name);
    const interrupted = a.status === "running" || a.status === "waiting" || a.status === "queued";
    t.workers.set(key(a.name), {
      sid, name: a.name, task: a.task, files: a.files ?? [], runs: a.runs ?? 1, text: "", started: Date.now(), ended: Date.now(),
      status: interrupted ? "stopped" : a.status, report: interrupted ? `${a.report ? `${a.report}\n\n` : ""}(Stopped when V-Run closed — message_agent it to carry on.)` : a.report,
      activity: interrupted ? "Stopped when V-Run closed" : a.status === "done" ? "Finished" : a.status === "failed" ? "Failed" : "Stopped",
      ...(a.reviewer ? { reviewer: true } : {}),
    });
    memberOf.set(sid, { team: t, name: a.name });
  }
  for (const [p, name] of saved.claims ?? []) t.claims.set(p, name === "supervisor" ? supervisor : workerSid(supervisor, name));
  for (const p of saved.changedSinceReview ?? []) t.changedSinceReview.add(p);
  t.reviews = saved.reviews ?? 0;
  publish(t);
  return true;
}
