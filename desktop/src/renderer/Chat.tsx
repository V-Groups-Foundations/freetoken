// AI pane: Agent / Ask modes, streamed Markdown, a transcript of tool calls (diffs, command output, grouped
// exploration), keyboard-driven command approvals, the plan checklist, a live status line, @file mentions,
// /commands and the "files changed" review bar.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type AgentEvent, type ChatAttachment, type FtProject, type MemoryStatus, type ToolDetail } from "./api";
import type { Selection } from "./Editor";
import { Logo } from "./Logo";
import { Markdown, OpenFileContext } from "./Markdown";
import { SkillsPanel } from "./Skills";
import { HistoryPanel } from "./History";
import { BenchmarkPanel } from "./Benchmark";
import { TeamPanel } from "./Team";
import { providerOf, shortModel, taskLabel } from "./models";

/** What the Check button (and /check) asks the agent. */
const CHECK_TEXT = "Check it: run the app, look at the page (console errors, the text and the screenshot), fix anything broken, missing or misplaced, check again, then tell me what works.";

type ToolItem = { kind: "tool"; id: string; name: string; input: any; status: "running" | "ok" | "error"; summary?: string; detail?: ToolDetail };
type Mode = "agent" | "team" | "plan" | "ask";
type Item =
  | { kind: "user"; text: string; chips: string[]; turn?: number; images?: string[] }
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string; start: number; ms?: number }
  | ToolItem
  | { kind: "approval"; id: string; command: string; explanation?: string; decided?: boolean | null; auto?: boolean }
  | { kind: "todos"; todos: { content: string; status: string }[] }
  | { kind: "error"; text: string }
  | { kind: "turn"; ms: number; tokens: number; estimated: boolean; reason: string; tools: number; mode: Mode; next: string[]; synced?: true | string; models?: string[] }
  | { kind: "history"; name: string; messages: FtProject["messages"] }
  | { kind: "note"; text: string }
  | { kind: "skills"; names: string[]; auto: boolean }
  // which model is working on this; a switch says what it moved away from
  | { kind: "model"; model: string; task?: string; fallbacks?: string; switched: boolean }
  // a provider couldn't be reached from this network (restricted Wi-Fi?)
  | { kind: "net"; text: string };

// display name, the input field shown in brackets, and the status-line verb
const TOOLS: Record<string, { label: string; arg?: string; verb: string }> = {
  read_file: { label: "Read", arg: "path", verb: "Reading" },
  list_dir: { label: "List", arg: "path", verb: "Listing" },
  grep_search: { label: "Search", arg: "pattern", verb: "Searching" },
  file_search: { label: "Find", arg: "query", verb: "Finding files" },
  codebase_search: { label: "Search codebase", arg: "query", verb: "Searching the codebase" },
  edit_file: { label: "Update", arg: "path", verb: "Editing" },
  write_file: { label: "Write", arg: "path", verb: "Writing" },
  delete_file: { label: "Delete", arg: "path", verb: "Deleting" },
  run_terminal_command: { label: "Run", arg: "command", verb: "Running" },
  run_app: { label: "Run app", arg: "command", verb: "Starting the app" },
  app_output: { label: "App output", verb: "Reading app output" },
  app_input: { label: "App input", arg: "text", verb: "Typing into the app" },
  stop_app: { label: "Stop app", verb: "Stopping the app" },
  save_check: { label: "Save check", arg: "name", verb: "Saving a check" },
  publish_site: { label: "Publish", arg: "name", verb: "Publishing the website" },
  run_checks: { label: "Run checks", verb: "Re-running the saved checks" },
  list_checkpoints: { label: "Checkpoints", verb: "Looking at the history" },
  restore_checkpoint: { label: "Restore", arg: "id", verb: "Restoring a snapshot" },
  open_preview: { label: "Preview", arg: "url", verb: "Opening the preview" },
  inspect_preview: { label: "Inspect page", verb: "Looking at the page" },
  remember: { label: "Remember", arg: "fact", verb: "Saving to memory" },
  use_skill: { label: "Skill", arg: "name", verb: "Loading skill" },
  web_search: { label: "Search the web", arg: "query", verb: "Searching the web" },
  fetch_url: { label: "Read", arg: "url", verb: "Reading the page" },
  save_skill: { label: "Learn skill", arg: "name", verb: "Learning skill" },
  install_skills: { label: "Install skills", arg: "source", verb: "Installing skills" },
  export_video: { label: "Export video", arg: "path", verb: "Rendering video" },
  spawn_agent: { label: "Start agent", arg: "name", verb: "Starting an agent" },
  agent_status: { label: "Team status", verb: "Checking the agents" },
  wait_for_agents: { label: "Wait for agents", verb: "Waiting for the agents" },
  message_agent: { label: "Message agent", arg: "agent", verb: "Messaging an agent" },
  stop_agent: { label: "Stop agent", arg: "agent", verb: "Stopping" },
  assign_file: { label: "Assign file", arg: "path", verb: "Assigning a file" },
  ask_supervisor: { label: "Ask supervisor", arg: "question", verb: "Asking the supervisor" },
};
const EXPLORE = new Set(["read_file", "list_dir", "grep_search", "file_search", "codebase_search", "inspect_preview", "app_output"]);
const FILE_ARG = new Set(["read_file", "edit_file", "write_file"]);
const THINKING = ["Thinking", "Reasoning", "Working", "Planning", "Considering"];
const SPIN = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
const SLASH: [string, string][] = [["/init", "Have the agent write V.md, this project's memory"], ["/memory", "Show what V-Run remembers (V.md)"], ["/skills", "Skills: what V-Run knows how to do; install from GitHub"], ["/check", "Have the agent run the app, look at it and fix what is broken"], ["/history", "Snapshots of your project: restore any point"], ["/benchmark", "Compare your FreeToken models on real coding tasks"], ["/new", "Start a new chat"], ["/clear", "Clear the conversation"], ["/agent", "Switch to Agent mode"], ["/team", "Switch to Team mode (several agents in parallel)"], ["/plan", "Switch to Plan mode (investigate, then propose)"], ["/ask", "Switch to Ask mode (read-only)"]];
const SUGGEST = ["Explain how this project is structured", "Run the app and check it works", "Find and fix a bug in the open file", "Write tests for the open file"];
const MODES: { id: Mode; label: string; hint: string; placeholder: string }[] = [
  { id: "agent", label: "Agent", hint: "Reads, edits and runs things — asks before running commands", placeholder: "Ask the agent to build, fix or run something…" },
  { id: "team", label: "Team", hint: "A supervisor splits the job between agents that work in parallel — each owns its files", placeholder: "Describe a bigger job — a team of agents will build it in parallel…" },
  { id: "plan", label: "Plan", hint: "Investigates the code and proposes a plan for you to approve — changes nothing yet", placeholder: "Describe what you want — you'll get a plan to approve first…" },
  { id: "ask", label: "Ask", hint: "Answers questions about your code — changes nothing", placeholder: "Ask a question about your code…" },
];
const INIT_PROMPT = "Create or improve V.md at the project root — V-Run's memory for this project, read at the start of every chat. First read the README, the package/config files and a few key source files. Then write V.md (under ~60 lines, specific to this codebase): ## Project (what it is, the stack), ## Commands (exact install / run / test / build commands; this machine runs Windows PowerShell), ## Layout (key folders and files), ## Conventions (style and patterns to follow), and ## Memory (keep every existing entry there). No secrets. Finish by summarising what you wrote.";
const EXECUTE_PLAN = "Go ahead and carry out the plan above, step by step. Keep a todo list and verify as you go.";

/** Next-step chips after a turn, picked from what actually happened in it. */
function followUps(turn: Item[], mode: Mode, reason: string): string[] {
  const tools = turn.filter((x): x is ToolItem => x.kind === "tool");
  const failed = tools.some((t) => t.status === "error") || turn.some((x) => x.kind === "error");
  const edited = tools.some((t) => t.status === "ok" && /^(edit_file|write_file|delete_file)$/.test(t.name));
  const ranApp = tools.some((t) => t.name === "run_app" && t.status === "ok");
  const ranCmd = tools.some((t) => t.name === "run_terminal_command" && t.status === "ok");
  const out: string[] = [];
  if (reason === "max_turns" || reason === "aborted") out.push("Continue where you left off");
  if (reason === "error") out.push("Try that again");
  if (mode === "ask") out.push("Make this change for me", "Show me where this is used");
  if (failed && reason !== "error") out.push("Fix the errors above");
  if (edited) out.push(ranCmd ? "Explain what you changed" : "Run the tests to check your changes", "Review your changes for bugs and edge cases");
  if (ranApp) out.push("Check the page for errors and fix them");
  else if (edited) out.push("Run the app so I can see it");
  if (!out.length && mode === "agent") out.push("What should we improve next?", "Write tests for this");
  return [...new Set(out)].slice(0, 3);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`);
const fmtTime = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

let sessionCounter = 0;
const newSessionId = () => `chat-${Date.now()}-${++sessionCounter}`;

export function ChatPanel(props: {
  activeFile: string | null; openFiles: string[];
  pendingSelection: Selection | null; clearSelection: () => void;
  onFilesChanged: (paths: string[]) => void; onReview: (sid: string, path: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  /** a prompt sent from elsewhere in the editor ("Fix with AI" on app errors, "Ask AI" in the preview) */
  inject: { text: string; n: number } | null;
  pendingVersion: number; focusSignal: number;
}) {
  const [sid, setSid] = useState(newSessionId);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("agent");
  // this project's last chat comes back after a window reload or an app restart
  const restored = useRef(false);
  useEffect(() => {
    let live = true;
    api.chatRestore().then((c) => {
      if (!live || !c?.sid || !Array.isArray(c.items) || !c.items.length) return;
      setSid(c.sid);
      // the agent is still working on it: show it as busy (Stop, live progress) — otherwise a new message
      // would start a second loop on the same session. Not running: unfinished steps were interrupted.
      if (c.running) {
        setItems(c.items as Item[]);
        turn.current = { ...turn.current, start: Date.now(), tokens: 0, chars: 0, tools: 0, waitUntil: 0, models: [], mode: (c.mode as Mode) ?? "agent" };
        setBusy(true);
      } else {
        setItems((c.items as Item[]).map((x) => (x.kind === "tool" && x.status === "running" ? { ...x, status: "error", summary: "Interrupted (window reloaded)" } : x)));
      }
      if (c.mode && MODES.some((m) => m.id === c.mode)) setMode(c.mode as Mode);
      if (c.interrupted) setInterrupted(c.interrupted);
    }).catch(() => {}).finally(() => { if (live) restored.current = true; });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!restored.current) return; // never overwrite the saved chat before it has been restored
    const t = setTimeout(() => {
      // pasted-image previews are page-local blob URLs: they can't come back after a reload
      const keep = items.slice(-400).map((x) => (x.kind === "user" && x.images ? { ...x, images: undefined } : x));
      api.chatSave({ sid, mode, items: keep }).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [items, sid, mode]);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ctxTokens, setCtxTokens] = useState(0);
  const [skipActive, setSkipActive] = useState(false);
  useEffect(() => setSkipActive(false), [props.activeFile]);
  const [confirmRewind, setConfirmRewind] = useState<number | null>(null);
  // a message sent while the agent was busy, waiting for the stop to finish
  const queued = useRef<{ text: string; as: Mode } | null>(null);
  const [queuedText, setQueuedText] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  // "Accept all" or "Step by step", asked when an Agent prompt is sent (remembered per chat if the user wants)
  const [chooser, setChooser] = useState<{ text: string; as: Mode } | null>(null);
  const [remember, setRemember] = useState(false);
  const policy = useRef<"all" | "step" | null>(null);
  // the FreeToken project this chat continues, if any
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  // V.md memory: what's in it, and the little panel in the header
  const [mem, setMem] = useState<MemoryStatus | null>(null);
  const [memOpen, setMemOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [benchOpen, setBenchOpen] = useState(false);
  useEffect(() => {
    const open = () => { setBenchOpen(true); setHistoryOpen(false); setSkillsOpen(false); };
    window.addEventListener("vrun-open-benchmark", open);
    return () => window.removeEventListener("vrun-open-benchmark", open);
  }, []);
  // a task that was running when V-Run closed: offered for resuming
  const [interrupted, setInterrupted] = useState<{ text: string; mode: string; startedAt: number } | null>(null);
  // pasted / dropped files and skills picked for the next message
  const [attach, setAttach] = useState<(ChatAttachment & { id: number; preview?: string })[]>([]);
  const [dragging, setDragging] = useState(false);
  const attachSeq = useRef(0);
  async function addFiles(files: File[]) {
    for (const f of files) {
      const id = ++attachSeq.current;
      const isImage = f.type.startsWith("image/");
      const preview = isImage ? URL.createObjectURL(f) : undefined;
      const onDisk = api.pathForFile(f);
      // a pasted screenshot has no file on disk: send its bytes (with a readable name)
      const name = !onDisk && isImage && /^image\.\w+$/.test(f.name) ? `screenshot-${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}.${f.type.split("/")[1] ?? "png"}` : f.name;
      if (onDisk) { setAttach((a) => [...a, { id, name, mime: f.type, path: onDisk, preview }]); continue; }
      if (f.size > 20 * 1024 * 1024) { setItems((p) => [...p, { kind: "error", text: `${name} is over 20 MB — not attached.` }]); continue; }
      const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1] ?? ""); r.onerror = () => reject(r.error); r.readAsDataURL(f); });
      setAttach((a) => [...a, { id, name, mime: f.type, data, preview }]);
    }
  }
  const refreshMem = () => api.memoryStatus().then(setMem).catch(() => {});
  useEffect(() => { refreshMem(); }, []);
  const [busy, setBusy] = useState(false);
  // the agent has built something in this chat: offer a one-click check of it
  const built = items.some((x) => x.kind === "tool" && (x.name === "write_file" || x.name === "edit_file") && x.status === "ok");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionHits, setMentionHits] = useState<string[]>([]);
  const [pick, setPick] = useState(0);
  const [pending, setPending] = useState<string[]>([]);
  // "Run all": auto-approve every command until the current task finishes
  const [autoRun, setAutoRun] = useState(false);
  const autoRunRef = useRef(autoRun);
  autoRunRef.current = autoRun;
  const [atBottom, setAtBottom] = useState(true);
  const turn = useRef({ start: 0, tokens: 0, chars: 0, tools: 0, verb: THINKING[0], mode: "agent" as Mode, waitUntil: 0, models: [] as string[] });
  const history = useRef<string[]>([]);
  const histPos = useRef(-1);
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const sidRef = useRef(sid);
  sidRef.current = sid;

  const refreshPending = () => api.pending(sidRef.current).then(setPending).catch(() => {});
  // set when the task was started with "Accept all": its file changes are kept without a review step
  const keepChanges = useRef(false);
  async function keepAll() {
    const sidNow = sidRef.current;
    const files = await api.pending(sidNow).catch(() => [] as string[]);
    for (const p of files) await api.accept(sidNow, p).catch(() => {});
    // above the turn's summary row, which must stay last (it carries Retry and the follow-ups)
    if (files.length) setItems((prev) => {
      const note: Item = { kind: "note", text: `Kept changes to ${files.length} file${files.length === 1 ? "" : "s"} — you chose Accept all. ✎ Edit or ↻ Retry undoes them.` };
      const at = prev.map((x) => x.kind).lastIndexOf("turn");
      return at < 0 ? [...prev, note] : [...prev.slice(0, at), note, ...prev.slice(at)];
    });
    refreshPending();
  }
  useEffect(() => { refreshPending(); }, [props.pendingVersion, sid]);
  useEffect(() => { if (props.focusSignal) box.current?.focus(); }, [props.focusSignal]);

  useEffect(() => api.onAgentEvent(({ sessionId, event }) => {
    if (sessionId !== sidRef.current) return;
    apply(event);
  }), []);

  // follow the stream only while the user is at the bottom; scrolling up to read stops the jumping
  const stick = useRef(true);
  useLayoutEffect(() => { if (stick.current) list.current?.scrollTo({ top: list.current.scrollHeight }); }, [items, busy]);
  const onScroll = () => {
    const el = list.current!;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stick.current = bottom;
    setAtBottom(bottom);
  };
  const jump = () => { stick.current = true; setAtBottom(true); list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); };

  // auto-grow the composer
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(240, el.scrollHeight)}px`;
    el.style.overflowY = el.scrollHeight > 240 ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    if (mentionQuery === null) return setMentionHits([]);
    let live = true;
    api.searchFiles(mentionQuery || "").then((r) => { if (live) { setMentionHits(r.slice(0, 8)); setPick(0); } }).catch(() => {});
    return () => { live = false; };
  }, [mentionQuery]);
  const slashHits = input.startsWith("/") && !input.includes(" ") ? SLASH.filter(([c]) => c.startsWith(input)) : [];
  useEffect(() => setPick(0), [slashHits.length]);

  function apply(e: AgentEvent) {
    const auto = e.type === "approval" && autoRunRef.current;
    if (auto) api.approve(sidRef.current, e.id, true);
    else if (e.type === "approval") api.notify("V-Run needs your approval", e.command).catch(() => {});
    const t = turn.current;
    if (e.type === "text") t.chars += e.delta.length;
    if (e.type === "usage") { t.tokens += e.output; if (e.input) setCtxTokens(e.input); }
    if (e.type === "tool_start") t.tools++;
    const switched = e.type === "model" && t.models.length > 0;
    if (e.type === "model") { window.dispatchEvent(new CustomEvent("vrun-model", { detail: e.model })); if (!t.models.includes(e.model)) t.models.push(e.model); }
    if (e.type === "waiting") t.waitUntil = Date.now() + e.seconds * 1000;
    else if (e.type === "text" || e.type === "tool_start" || e.type === "thinking") t.waitUntil = 0;
    setItems((prev) => {
      const next = [...prev];
      // a thinking block ends as soon as anything else arrives
      const lastT = next[next.length - 1];
      if (lastT?.kind === "thinking" && lastT.ms === undefined && e.type !== "thinking" && e.type !== "usage")
        next[next.length - 1] = { ...lastT, ms: Date.now() - lastT.start };
      const last = next[next.length - 1];
      switch (e.type) {
        case "turn_start": {
          const u = [...next].reverse().find((x) => x.kind === "user" && x.turn === undefined);
          if (u) next[next.lastIndexOf(u)] = { ...(u as Extract<Item, { kind: "user" }>), turn: e.index };
          break;
        }
        case "thinking":
          if (last?.kind === "thinking" && last.ms === undefined) next[next.length - 1] = { ...last, text: last.text + e.delta };
          else next.push({ kind: "thinking", text: e.delta, start: Date.now() });
          break;
        case "text":
          if (last?.kind === "text") next[next.length - 1] = { ...last, text: last.text + e.delta };
          else if (e.delta.trim()) next.push({ kind: "text", text: e.delta.replace(/^\s+/, "") });
          break;
        case "tool_start":
          if (e.name !== "todo_write") next.push({ kind: "tool", id: e.id, name: e.name, input: e.input, status: "running" });
          break;
        case "tool_end": {
          const i = next.findIndex((x) => x.kind === "tool" && x.id === e.id);
          if (i >= 0) next[i] = { ...(next[i] as ToolItem), status: e.ok ? "ok" : "error", summary: e.summary, detail: e.detail };
          next.forEach((x, j) => { if (x.kind === "approval" && x.id === e.id && x.decided === undefined) next[j] = { ...x, decided: null }; });
          break;
        }
        case "approval":
          next.push({ kind: "approval", id: e.id, command: e.command, explanation: e.explanation, ...(auto ? { decided: true, auto: true } : {}) });
          break;
        case "todos": {
          const i = next.findIndex((x) => x.kind === "todos");
          if (i >= 0) next.splice(i, 1);
          next.push({ kind: "todos", todos: e.todos });
          break;
        }
        case "error":
          next.push({ kind: "error", text: e.message });
          break;
        case "memory":
          next.push({ kind: "note", text: e.added ? `Remembered in ${e.scope === "user" ? "your personal memory" : "V.md"}: ${e.line.replace(/^- /, "")}` : "Already in memory" });
          break;
        case "skill":
          next.push({ kind: "note", text: `Learned skill${e.name.includes(",") ? "s" : ""}: ${e.name}` });
          break;
        case "network_warning":
          next.push({ kind: "net", text: e.message });
          break;
        case "model":
          next.push({ kind: "model", model: e.model, task: e.task, fallbacks: e.fallbacks, switched });
          break;
        case "skills_used":
          next.push({ kind: "skills", names: e.names, auto: e.auto });
          break;
        case "progress": {
          const i = next.findIndex((x) => x.kind === "tool" && x.id === e.id);
          if (i >= 0 && (next[i] as ToolItem).status === "running") next[i] = { ...(next[i] as ToolItem), summary: e.text };
          break;
        }
        case "synced": {
          const k = next.map((x) => x.kind).lastIndexOf("turn");
          if (k >= 0) next[k] = { ...(next[k] as Extract<Item, { kind: "turn" }>), synced: e.ok ? true : e.error ?? "failed" };
          break;
        }
        case "done":
          next.forEach((x, j) => { if (x.kind === "tool" && x.status === "running") next[j] = { ...x, status: "error", summary: "Interrupted" }; });
        {
          const since = next.map((x) => x.kind).lastIndexOf("user");
          const m = turn.current.mode;
          next.push({ kind: "turn", ms: Date.now() - t.start, tokens: t.tokens || Math.round(t.chars / 4), estimated: !t.tokens, reason: e.stopReason, tools: t.tools, models: [...t.models],
            mode: m, next: m === "plan" && e.stopReason !== "error" ? [] : followUps(next.slice(since + 1), m, e.stopReason) });
          break;
        }
      }
      return next;
    });
    if (e.type === "file_changed") { props.onFilesChanged([e.path]); refreshPending(); }
    if (e.type === "done") {
      setBusy(false); setAutoRun(false); refreshMem();
      // "Accept all" chosen up front means no questions at all: keep the file changes too (✎ Edit / ↻ Retry still undo them)
      if (keepChanges.current) { keepChanges.current = false; keepAll(); } else refreshPending();
    }
    if (e.type === "memory") refreshMem();
  }

  async function send(raw = input, as: Mode = modeRef.current, run?: "all" | "step") {
    const text = raw.trim() || (attach.length ? "Have a look at what I attached." : "");
    if (!text) return;
    // typing while the agent works: stop it, then send this as soon as it has stopped
    if (busy) {
      queued.current = { text, as };
      setQueuedText(text);
      setInput("");
      setStopping(true);
      api.stop(sidRef.current);
      return;
    }
    if (/^\/(new|clear)$/.test(text)) { setInput(""); return newChat(); }
    if (text === "/check") return send(CHECK_TEXT, "agent", run);
    if (/^\/(ask|agent|plan|team)$/.test(text)) { setMode(text.slice(1) as Mode); setInput(""); return; }
    if (text === "/memory") { setInput(""); setMemOpen(true); refreshMem(); return; }
    if (text === "/skills") { setInput(""); setMemOpen(false); setSkillsOpen(true); return; }
    if (text === "/benchmark") { setInput(""); setMemOpen(false); setSkillsOpen(false); setHistoryOpen(false); setBenchOpen(true); return; }
    if (text === "/history") { setInput(""); setMemOpen(false); setSkillsOpen(false); setHistoryOpen(true); return; }
    if (text === "/init") { setInput(""); return send(INIT_PROMPT, "agent", run); }
    // "# something" is a note to remember, not a message (Ctrl+Enter: personal memory)
    if (/^#(?!#)\s*\S/.test(text)) { await saveNote(text.replace(/^#\s*/, ""), noteScope.current); noteScope.current = "project"; return; }
    // Agent work can run commands: ask once, up front, whether to run everything or approve each step
    if (as === "agent" || as === "team") {
      run ??= policy.current ?? undefined;
      if (!run) { setChooser({ text, as }); return; }
      autoRunRef.current = run === "all";
      setAutoRun(run === "all");
      keepChanges.current = run === "all";
    }
    setChooser(null);
    const mode = as;
    if (mode !== modeRef.current) setMode(mode);
    setConfirmRewind(null);
    const sel = props.pendingSelection;
    const chips = [...mentions.map((m) => `@${m}`), ...(sel ? [`${sel.path}:${sel.start}-${sel.end}`] : [])];
    history.current = [text, ...history.current.filter((h) => h !== text)].slice(0, 50);
    histPos.current = -1;
    turn.current = { start: Date.now(), tokens: 0, chars: 0, tools: 0, verb: THINKING[Math.floor(Math.random() * THINKING.length)], mode, waitUntil: 0, models: [] };
    stick.current = true;
    const files = attach;
    chips.push(...files.filter((f) => !f.preview).map((f) => `📎 ${f.name}`));
    setItems((p) => [...p, { kind: "user", text, chips, images: files.filter((f) => f.preview).map((f) => f.preview!) }]);
    setInput(""); setMentions([]); props.clearSelection(); setAttach([]);
    setBusy(true);
    try {
      await api.chat({ sessionId: sid, mode, text, context: {
        activeFile: (!skipActive && props.activeFile) || undefined, openFiles: props.openFiles, mentionedFiles: mentions,
        selection: sel && sel.text ? sel : undefined },
        attachments: files.length ? files.map(({ name, mime, data, path }) => ({ name, mime, data, path })) : undefined });
    } catch (e) {
      setBusy(false);
      setItems((p) => [...p, { kind: "error", text: (e as Error).message }]);
    }
  }

  function decide(id: string, ok: boolean, all = false) {
    if (all) setAutoRun(true);
    api.approve(sid, id, ok);
    setItems((p) => p.map((x) => (x.kind === "approval" && x.id === id ? { ...x, decided: ok } : x)));
    box.current?.focus();
  }

  async function newChat() {
    if (busy) await api.stop(sid);
    api.resetChat(sid);
    setSid(newSessionId()); setItems([]); setBusy(false); setPending([]); setAutoRun(false); setCtxTokens(0); setConfirmRewind(null);
    setChooser(null); policy.current = null; setRemember(false); setProject(null);
    box.current?.focus();
  }

  const noteScope = useRef<"project" | "user">("project");
  async function saveNote(fact: string, scope: "project" | "user") {
    try {
      const r = await api.remember(fact, scope);
      setItems((p) => [...p, { kind: "note", text: r.added ? `Remembered in ${scope === "user" ? "your personal memory" : "V.md"}: ${fact}` : "Already in memory" }]);
      setInput("");
      refreshMem();
    } catch (e) { setItems((p) => [...p, { kind: "error", text: (e as Error).message }]); }
  }
  async function openMemory(scope: "project" | "user") {
    setMemOpen(false);
    try { const rel = await api.openMemory(scope); if (rel) props.onOpenFile(rel); refreshMem(); }
    catch (e) { setItems((p) => [...p, { kind: "error", text: (e as Error).message }]); }
  }

  function choose(run: "all" | "step") {
    const c = chooser;
    if (!c) return;
    if (remember) policy.current = run;
    send(c.text, c.as, run);
  }

  // a FreeToken project handed over ("Continue in V-Run"): start a chat seeded with its conversation
  async function continueProject() {
    const p = await api.ftTakeProject().catch(() => null);
    if (!p) return;
    if (busy) await api.stop(sidRef.current);
    api.resetChat(sidRef.current);
    const next = newSessionId();
    await api.ftContinue(next, p.id);
    sidRef.current = next;
    setSid(next); setBusy(false); setPending([]); setAutoRun(false); setCtxTokens(0); setChooser(null);
    setItems(p.messages.length ? [{ kind: "history", name: p.name, messages: p.messages }] : []);
    setProject({ id: p.id, name: p.name });
    setMode("agent");
    box.current?.focus();
  }
  useEffect(() => {
    continueProject();
    return api.onFtProject(() => continueProject());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Undo the user message at `at` and everything after it: files the agent changed are restored, the transcript is cut. */
  async function rewindTo(at: number) {
    const u = items[at];
    if (busy || u?.kind !== "user" || u.turn === undefined) return null;
    const restored = await api.rewind(sid, u.turn);
    if (restored.length) props.onFilesChanged(restored);
    setItems((p) => p.slice(0, at));
    setConfirmRewind(null);
    refreshPending();
    return u;
  }
  async function editFrom(at: number) {
    const u = await rewindTo(at);
    if (u) { setInput(u.text); box.current?.focus(); }
  }
  async function retryLast() {
    const at = items.map((x) => x.kind).lastIndexOf("user");
    const m = [...items].reverse().find((x) => x.kind === "turn") as Extract<Item, { kind: "turn" }> | undefined;
    const u = await rewindTo(at);
    if (u) send(u.text, m?.mode);
  }

  useEffect(() => {
    if (busy) return;
    setStopping(false);
    const q = queued.current;
    if (q) { queued.current = null; setQueuedText(null); send(q.text, q.as); }
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // prompts from the rest of the editor
  useEffect(() => {
    if (!props.inject) return;
    if (busy) { setInput(props.inject.text); box.current?.focus(); }
    else send(props.inject.text, "agent");
  }, [props.inject?.n]);

  const waiting = items.find((x): x is Extract<Item, { kind: "approval" }> => x.kind === "approval" && x.decided === undefined);

  // keyboard: Esc interrupts (or skips a pending command); 1 / 2 / 3 answer the approval prompt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("[role=dialog]")) return;
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      // the approval keys (1 / 2 / 3 / Esc) belong to the chat: never while typing in the code editor,
      // the terminal or any other field — "1" typed in code must not approve a shell command
      const target = e.target instanceof Element ? e.target : null;
      const inChat = !target || target === document.body || !!target.closest(".chat");
      if (waiting && inChat && !(typing && (e.target as HTMLTextAreaElement).value)) {
        const k = e.key;
        if (k === "1" || k === "2" || k === "3" || (k === "Escape" && !mentionHits.length)) {
          e.preventDefault();
          return decide(waiting.id, k !== "3" && k !== "Escape", k === "2");
        }
      }
      if (e.key === "Escape" && busy && !waiting && !mentionHits.length && !slashHits.length
        && (typing ? e.target === box.current : document.activeElement?.closest(".chat"))) { e.preventDefault(); api.stop(sidRef.current); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onInput(v: string) {
    setInput(v);
    const caret = box.current?.selectionStart ?? v.length;
    const m = v.slice(0, caret).match(/(?:^|\s)@([\w./-]*)$/);
    setMentionQuery(m ? m[1] : null);
  }
  function pickMention(path: string) {
    const caret = box.current?.selectionStart ?? input.length;
    const before = input.slice(0, caret).replace(/@[\w./-]*$/, "");
    setInput(before + input.slice(caret));
    setMentions((m) => (m.includes(path) ? m : [...m, path]));
    setMentionQuery(null);
    setMentionHits([]); // now, not in the effect: an Enter right after picking must send, not pick again
    box.current?.focus();
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const pop = mentionHits.length ? mentionHits : slashHits.length ? slashHits.map(([c]) => c) : null;
    if (pop) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setPick((p) => (p + (e.key === "ArrowDown" ? 1 : pop.length - 1)) % pop.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (mentionHits.length) pickMention(mentionHits[pick] ?? mentionHits[0]);
        else if (e.key === "Enter") send(pop[pick] ?? pop[0]);
        else setInput(pop[pick] ?? pop[0]);
        return;
      }
      if (e.key === "Escape") { e.preventDefault(); setMentionQuery(null); if (slashHits.length) setInput(""); return; }
    }
    if (e.key === "Tab" && e.shiftKey) { e.preventDefault(); setMode((m) => MODES[(MODES.findIndex((x) => x.id === m) + 1) % MODES.length].id); return; }
    // ↑ / ↓ on an empty (or recalled) prompt walks through what you sent before
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && (!input || histPos.current >= 0) && !input.includes("\n")) {
      const h = history.current;
      const pos = Math.max(-1, Math.min(h.length - 1, histPos.current + (e.key === "ArrowUp" ? 1 : -1)));
      if (pos !== histPos.current) { e.preventDefault(); histPos.current = pos; setInput(pos < 0 ? "" : h[pos]); }
      return;
    }
    if (e.key === "Enter" && e.ctrlKey && /^#(?!#)/.test(input)) { e.preventDefault(); noteScope.current = "user"; send(); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function acceptAll() { for (const p of pending) await api.accept(sid, p); refreshPending(); }
  async function rejectAll() { for (const p of pending) await api.reject(sid, p); props.onFilesChanged(pending); refreshPending(); }

  // status-line verb: what the agent is doing right now
  const running = [...items].reverse().find((x): x is ToolItem => x.kind === "tool" && x.status === "running");
  const verb = waiting ? "Waiting for your approval"
    : turn.current.waitUntil > Date.now() ? `Free models are busy — retrying in ${Math.ceil((turn.current.waitUntil - Date.now()) / 1000)}s`
    : running ? `${TOOLS[running.name]?.verb ?? "Running"}${argOf(running) && running.name !== "run_terminal_command" ? ` ${short(baseName(argOf(running)), 32)}` : ""}`
    : items[items.length - 1]?.kind === "thinking" ? "Thinking"
    : turn.current.verb;
  const modeInfo = MODES.find((m) => m.id === mode)!;
  const title = items.find((x) => x.kind === "user") as Extract<Item, { kind: "user" }> | undefined;
  const rows = useMemo(() => group(items), [items]);

  return (
    <aside className={`chat${dragging ? " dragging" : ""}`} aria-label="AI chat"
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!dragging) setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDragging(false); addFiles([...e.dataTransfer.files]); box.current?.focus(); }}>
      {dragging && <div className="drop-overlay" aria-hidden><div><b>Drop to attach</b><span>Images, screenshots, code, CSV, PDF… — saved in the project and shared with the AI</span></div></div>}
      <div className="chat-head">
        {project
          ? <button className="chat-title ft-link" onClick={() => api.ftWebsite(`/projects/${project.id}`)} title="This chat continues a FreeToken project — click to open its page on the FreeToken website">✦ {project.name}</button>
          : <span className="chat-title" title={title?.text}>{title ? short(title.text, 40) : "New chat"}</span>}
        <span className="spacer" />
        <button className={`mem-btn${mem?.project.exists || mem?.user.exists ? " on" : ""}`} onClick={() => { setMemOpen((v) => !v); refreshMem(); }}
          aria-label="Memory" aria-expanded={memOpen} title="What V-Run remembers (V.md)">
          <span aria-hidden>◆</span> Memory{mem && mem.project.entries + mem.user.entries > 0 ? <span className="mem-count">{mem.project.entries + mem.user.entries}</span> : null}
        </button>
        <button className={`mem-btn${skillsOpen ? " on" : ""}`} onClick={() => { setSkillsOpen((v) => !v); setMemOpen(false); }}
          aria-label="Skills" aria-expanded={skillsOpen} title="Skills (/skills)"><span aria-hidden>✦</span> Skills</button>
        <button className={`mem-btn${historyOpen ? " on" : ""}`} onClick={() => { setHistoryOpen((v) => !v); setSkillsOpen(false); setMemOpen(false); }}
          aria-label="History" aria-expanded={historyOpen} title="Snapshots of your project — restore any point (/history)"><span aria-hidden>↺</span> History</button>
        <button className="icon-btn" onClick={newChat} title="New chat (/new)" aria-label="New chat">＋</button>
      </div>
      {interrupted && !busy && (
        <div className="resume-bar" role="status">
          <span><b>A task was interrupted</b> when V-Run closed: <i>{interrupted.text.slice(0, 140)}{interrupted.text.length > 140 ? "…" : ""}</i></span>
          <span className="spacer" />
          <button className="btn small primary" onClick={() => {
            const t = interrupted;
            setInterrupted(null);
            send(`Continue the task you were working on when V-Run closed: "${t.text}". First check what's already done (the files, your todo list, the app), then finish the rest.`, (MODES.some((m) => m.id === t.mode) ? t.mode : "agent") as Mode);
          }}>Resume</button>
          <button className="btn small" onClick={() => { setInterrupted(null); api.chatDismissInterrupted(sidRef.current).catch(() => {}); }}>Dismiss</button>
        </div>
      )}
      {benchOpen && <BenchmarkPanel busy={busy} onClose={() => setBenchOpen(false)} />}
      {historyOpen && <HistoryPanel busy={busy} onClose={() => setHistoryOpen(false)} onRestored={(files) => { props.onFilesChanged(files); refreshPending(); }} />}
      {skillsOpen && <SkillsPanel busy={busy} onClose={() => setSkillsOpen(false)} onPrefill={(t) => setInput(t)} onAsk={(t) => send(t)} />}
      {memOpen && (
        <div className="mem-panel" role="dialog" aria-label="Memory">
          <div className="mem-head"><b>V-Run memory</b><span className="spacer" /><button className="icon-btn" onClick={() => setMemOpen(false)} aria-label="Close memory">✕</button></div>
          <p className="muted small">Read at the start of every chat. The agent adds to it when you tell it something lasting; type <kbd>#</kbd> + a note to add one yourself.</p>
          {([["project", "This project", "V.md — commit it to share with your team"], ["user", "Personal", "~/.v-run/V.md — every project"]] as const).map(([scope, title, hint]) => {
            const f = mem?.[scope];
            return (
              <div key={scope} className="mem-file">
                <div className="mem-file-main"><b>{title}</b><div className="muted small">{hint}</div>
                  <div className="small">{f?.exists ? `${f.entries} remembered item${f.entries === 1 ? "" : "s"} · ${f.lines} lines` : "Not created yet"}</div></div>
                <button className="btn small" onClick={() => openMemory(scope)}>{f?.exists ? "Open" : "Create"}</button>
              </div>
            );
          })}
          <button className="btn primary small" onClick={() => { setMemOpen(false); send("/init"); }} disabled={busy}>✦ /init — let the agent write this project's V.md</button>
        </div>
      )}

      <OpenFileContext.Provider value={props.onOpenFile}>
        <div className="chat-list" ref={list} onScroll={onScroll} aria-live="polite">
          {!items.length && (
            <div className="chat-empty">
              <Logo size={44} />
              <h2>What should we build?</h2>
              <p className="muted">{modeInfo.hint}.</p>
              {mem?.project.file && !mem.project.exists && (
                <div className="init-offer" role="note">
                  <span aria-hidden>◆</span>
                  <div><b>This project has no V.md yet.</b> <span className="muted">Let the agent note how to run, test and build it, so every chat starts knowing the project.</span></div>
                  <button className="btn primary small" onClick={() => send("/init")} disabled={busy}>Set up V.md</button>
                </div>
              )}
              <div className="suggestions">
                {SUGGEST.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
              </div>
              <p className="muted small"><kbd>@</kbd> attach a file · <kbd>/</kbd> commands · <kbd>Ctrl</kbd>+<kbd>L</kbd> add selected code · <kbd>Shift</kbd>+<kbd>Tab</kbd> switch mode</p>
            </div>
          )}
          {rows.map((r, i) => {
            if (Array.isArray(r)) return <ExploreGroup key={r[0].id} tools={r} />;
            switch (r.kind) {
              case "user": {
                const at = items.indexOf(r);
                return (
                  <div key={i} className="msg-user-wrap">
                    <div className="msg-user">{r.chips.length > 0 && <div className="chips">{r.chips.map((c) => <span key={c} className="chip">{c}</span>)}</div>}{r.images?.length ? <div className="msg-images">{r.images.map((u) => <img key={u} src={u} alt="Attached" />)}</div> : null}{r.text}</div>
                    {!busy && r.turn !== undefined && confirmRewind !== at && (
                      <div className="msg-actions">
                        <button className="icon-btn" onClick={() => setConfirmRewind(at)} aria-label="Edit this message" title="Edit and resend — undoes everything after this point">✎ Edit</button>
                      </div>
                    )}
                    {confirmRewind === at && (
                      <div className="rewind-confirm" role="group" aria-label="Rewind">
                        <span>Go back to this message? The conversation after it is removed and files the agent changed since are restored.</span>
                        <div className="row"><button className="btn small" onClick={() => setConfirmRewind(null)}>Cancel</button>
                          <button className="btn small primary" onClick={() => editFrom(at)}>Rewind &amp; edit</button></div>
                      </div>
                    )}
                  </div>
                );
              }
              case "thinking": return <Thinking key={i} t={r} />;
              case "history": return <History key={i} name={r.name} messages={r.messages} />;
              case "note": return <div key={i} className="mem-note" role="status"><span aria-hidden>◆</span>{r.text}</div>;
              case "net": return <div key={i} className="net-warning" role="alert"><span aria-hidden>⚠</span><span>{r.text}</span></div>;
              case "model": return (
                <div key={i} className={`model-row${r.switched ? " switched" : ""}`} title={`${r.model}${r.fallbacks ? `\nTried first: ${r.fallbacks}` : ""}`}>
                  <span aria-hidden>{r.switched ? "↪" : "◇"}</span>
                  {r.switched ? "Switched to " : ""}<b>{shortModel(r.model)}</b><span className="muted"> · {providerOf(r.model)}</span>
                  {r.task && <span className="muted"> — picked for {taskLabel(r.task)}</span>}
                  {r.fallbacks && <span className="muted"> (unavailable: {r.fallbacks.split(", ").map((f) => f.replace(/^([^/]+)\/(\S+)/, (_m, _p, id) => shortModel(id))).join(", ")})</span>}
                </div>
              );
              case "skills": return (
                <div key={i} className="skill-badge" role="status" aria-label={`Using skill: ${r.names.join(", ")}`}>
                  <span className="skill-badge-icon" aria-hidden>✦</span>
                  <span>Using skill{r.names.length > 1 ? "s" : ""}</span>
                  {r.names.map((n) => <b key={n} className="skill-badge-name">{n}</b>)}
                  <span className="skill-badge-why">{r.auto ? "matched your request" : "you picked it"}</span>
                </div>
              );
              case "text": return <AiText key={i} text={r.text} streaming={busy && i === rows.length - 1} />;
              case "tool": return <ToolRow key={r.id} t={r} waiting={waiting?.id === r.id} />;
              case "approval": return <Approval key={`a${r.id}`} a={r} tool={items.find((x): x is ToolItem => x.kind === "tool" && x.id === r.id)} onDecide={decide} />;
              case "todos": return <Todos key={i} todos={r.todos} />;
              case "error": return <div key={i} className="row-err" role="alert"><span className="dot err" aria-hidden />{r.text}</div>;
              case "turn": {
                const latest = !busy && r === items[items.length - 1];
                return (
                  <div key={i} className="turn-wrap">
                    <div className="turn-end">
                      {r.reason === "aborted" ? "Interrupted" : r.reason === "error" ? "Stopped on an error" : "Done"} · {fmtTime(r.ms)}
                      {r.tools > 0 && ` · ${plural(r.tools, "step")}`}{r.models && r.models.length > 0 && <span title={r.models.join("\n")}> · {r.models.map(shortModel).join(" → ")}</span>}{r.tokens > 0 && ` · ${r.estimated ? "~" : ""}${fmtTokens(r.tokens)} tokens`}
                      {r.synced === true && <span className="synced" title="This turn was added to the FreeToken project"> · ✓ saved to FreeToken</span>}
                      {typeof r.synced === "string" && <span className="synced err" title={r.synced}> · not saved to FreeToken</span>}
                      {latest && <button className="icon-btn retry" onClick={retryLast} title="Undo this answer and its file changes, and ask again">↻ Retry</button>}
                    </div>
                    {latest && r.mode === "plan" && r.reason !== "error" && (
                      <div className="plan-cta">
                        <button className="btn primary" onClick={() => send(EXECUTE_PLAN, "agent")}>▶ Approve plan &amp; build</button>
                        <button className="btn" onClick={() => { setInput(""); box.current?.focus(); }}>Refine the plan</button>
                      </div>
                    )}
                    {latest && r.next.length > 0 && (
                      <div className="followups" aria-label="Suggested next steps">
                        {r.next.map((s) => <button key={s} onClick={() => send(s, s === "Make this change for me" ? "agent" : r.mode === "plan" ? "plan" : undefined)}>{s}</button>)}
                      </div>
                    )}
                  </div>
                );
              }
            }
          })}
          {busy && !waiting && <StatusLine verb={verb} start={turn.current.start} turn={turn} />}
        </div>
        {!atBottom && <button className="jump" onClick={jump}>↓ Jump to latest</button>}
      </OpenFileContext.Provider>

      <TeamPanel sid={sid} autoApprove={() => autoRunRef.current} />
      {pending.length > 0 && !keepChanges.current && (
        <div className="review-bar" aria-label="Files changed">
          <div className="review-title">{pending.length} file{pending.length > 1 ? "s" : ""} changed
            <span className="spacer" /><button className="btn small" onClick={rejectAll}>Reject all</button><button className="btn small primary" onClick={acceptAll}>Accept all</button></div>
          {pending.map((p) => (
            <div key={p} className="review-file">
              <button className="linklike" onClick={() => props.onReview(sid, p)}>{p}</button>
              <span className="spacer" />
              <button className="btn small" aria-label={`Reject ${p}`} onClick={async () => { await api.reject(sid, p); props.onFilesChanged([p]); refreshPending(); }}>✕</button>
              <button className="btn small primary" aria-label={`Accept ${p}`} onClick={async () => { await api.accept(sid, p); refreshPending(); }}>✓</button>
            </div>
          ))}
        </div>
      )}

      <div className="composer">
        {queuedText && (
          <div className="queued" role="status"><span>⏹ Stopping, then sending: <b>{short(queuedText, 60)}</b></span>
            <button className="linklike" onClick={() => { queued.current = null; setQueuedText(null); }}>Cancel</button></div>
        )}
        {autoRun && busy && (
          <div className="autorun" role="status"><span>⏵⏵ Auto-running commands until this task finishes</span>
            <button className="linklike" onClick={() => setAutoRun(false)}>Turn off</button></div>
        )}
        {mentionHits.length > 0 && (
          <div className="pop mention-pop" role="listbox" aria-label="Files">
            {mentionHits.map((f, i) => <button key={f} role="option" aria-selected={i === pick} className={i === pick ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); pickMention(f); }}>{f}</button>)}
          </div>
        )}
        {!mentionHits.length && slashHits.length > 0 && (
          <div className="pop" role="listbox" aria-label="Commands">
            {slashHits.map(([c, d], i) => <button key={c} role="option" aria-selected={i === pick} className={i === pick ? "on" : ""} onMouseDown={(e) => { e.preventDefault(); send(c); }}><b>{c}</b> <span className="muted">{d}</span></button>)}
          </div>
        )}
        {/^#(?!#)/.test(input) && !chooser && (
          <div className="mem-hint" role="status"><span aria-hidden>◆</span> <b>Enter</b> saves this note to V.md · <b>Ctrl+Enter</b> to your personal memory</div>
        )}
        {chooser && (
          <div className="run-choice" role="group" aria-label="How should the agent run this task?"
            onKeyDown={(e) => {
              const pick = (run: "all" | "step") => { e.preventDefault(); choose(run); };
              if (e.key === "1") pick("all");
              else if (e.key === "2") pick("step");
              else if (e.key === "Escape") { e.preventDefault(); setChooser(null); box.current?.focus(); }
              else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(".choice")];
                btns[(btns.indexOf(document.activeElement as HTMLButtonElement) + 1) % btns.length]?.focus();
              }
            }}>
            <div className="run-choice-title">How should the agent work on this?</div>
            <button className="choice primary" autoFocus onClick={() => choose("all")}>
              <kbd aria-hidden>1</kbd><span><b>Accept all</b><span className="muted"> — runs every command and edit until the job is done, no more questions</span></span>
            </button>
            <button className="choice" onClick={() => choose("step")}>
              <kbd aria-hidden>2</kbd><span><b>Step by step</b><span className="muted"> — asks you before each command</span></span>
            </button>
            <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Don&apos;t ask again in this chat</label>
            <div className="muted small">Press 1 or 2 · Esc to keep editing</div>
          </div>
        )}
        <div className={`composer-box${busy ? " busy" : ""}`} onClick={(e) => e.target === e.currentTarget && box.current?.focus()}>
          {attach.length > 0 && (
            <div className="chips attach-chips">
              {attach.map((a) => (
                <span key={a.id} className={`chip attach${a.preview ? " img" : ""}`} title={a.path ?? a.name}>
                  {a.preview ? <img src={a.preview} alt="" /> : <span aria-hidden>📎</span>}{a.name}
                  <button aria-label={`Remove ${a.name}`} onClick={() => setAttach((x) => x.filter((y) => y.id !== a.id))}>✕</button>
                </span>
              ))}
            </div>
          )}
          {(mentions.length > 0 || props.pendingSelection || (props.activeFile && !skipActive)) && (
            <div className="chips">
              {props.activeFile && !skipActive && (
                <span className="chip ctx" title="The file you have open is shared with the AI">{baseName(props.activeFile)} <span className="muted">· current file</span>
                  <button aria-label="Don't share the current file" onClick={() => setSkipActive(true)}>✕</button></span>
              )}
              {mentions.map((m) => <span key={m} className="chip">@{m} <button aria-label={`Remove ${m}`} onClick={() => setMentions((x) => x.filter((y) => y !== m))}>✕</button></span>)}
              {props.pendingSelection && <span className="chip">{props.pendingSelection.path}:{props.pendingSelection.start}-{props.pendingSelection.end} <button aria-label="Remove selection" onClick={props.clearSelection}>✕</button></span>}
            </div>
          )}
          <textarea ref={box} rows={1} aria-label="Message the AI"
            placeholder={busy ? "Type to stop it and do this instead…" : project && mode === "agent" ? `Continue ${project.name}…` : modeInfo.placeholder}
            value={input} onChange={(e) => onInput(e.target.value)} onKeyDown={onKeyDown}
            onPaste={(e) => { const files = [...e.clipboardData.files]; if (!files.length) return; if (!e.clipboardData.getData("text")) e.preventDefault(); addFiles(files); }} />
          <div className="composer-row">
            <div className={`mode-switch m-${mode}`} role="radiogroup" aria-label="Mode">
              {MODES.map((m) => (
                <button key={m.id} role="radio" aria-checked={mode === m.id} className={mode === m.id ? "on" : ""} onClick={() => setMode(m.id)} title={`${m.hint} (Shift+Tab to switch)`}>
                  {m.label}
                </button>
              ))}
            </div>
            <span className="spacer" />
            {!busy && built && <button className="btn small check-it" onClick={() => send(CHECK_TEXT, "agent")} title="Run the app, look at the page (console, text and a screenshot), fix what's broken, then report what works">✓ Check</button>}
            {ctxTokens > 0 && <span className="ctx-meter" title={`The model read ${ctxTokens.toLocaleString()} tokens of context on its last step. Start a new chat (/new) when switching to an unrelated task.`}>{fmtTokens(ctxTokens)} context</span>}
            {busy ? <button className={`send stop${stopping ? " stopping" : ""}`} onClick={() => { setStopping(true); api.stop(sid); }} aria-label="Stop the agent" title={stopping ? "Stopping…" : "Stop (Esc) — or just type your next message"}><span /></button>
              : <button className="send" onClick={() => send()} disabled={!input.trim()} aria-label="Send" title="Send (Enter)">↑</button>}
          </div>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------- transcript pieces

/** Fold runs of 2+ finished read-only steps into one "Explored" row so edits and commands stand out. */
function group(items: Item[]): (Item | ToolItem[])[] {
  const out: (Item | ToolItem[])[] = [];
  let run: ToolItem[] = [];
  const flush = () => { if (run.length >= 2) out.push(run); else out.push(...run); run = []; };
  for (const it of items) {
    if (it.kind === "tool" && EXPLORE.has(it.name) && it.status === "ok") { run.push(it); continue; }
    flush();
    out.push(it);
  }
  flush();
  return out;
}

const argOf = (t: ToolItem) => { const k = TOOLS[t.name]?.arg; return k && t.input ? String(t.input[k] ?? "") : ""; };
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

function AiText({ text, streaming }: { text: string; streaming: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="msg-ai">
      <span className="dot ai" aria-hidden />
      <div className="msg-body"><Markdown text={text} streaming={streaming} /></div>
      {!streaming && (
        <button className="icon-btn msg-copy" aria-label="Copy message" title="Copy"
          onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}>{copied ? "✓" : "⧉"}</button>
      )}
    </div>
  );
}

/** The conversation a FreeToken project brought with it: the last few turns, the rest on demand. */
function History({ name, messages }: { name: string; messages: FtProject["messages"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? messages : messages.slice(-4);
  return (
    <div className="history" aria-label="Earlier in FreeToken">
      <div className="history-head"><span className="spark" aria-hidden>✦</span>Continued from FreeToken · <b>{name}</b>
        <span className="muted"> · {plural(messages.length, "message")}</span></div>
      {!all && messages.length > shown.length && <button className="more" onClick={() => setAll(true)}>Show {messages.length - shown.length} earlier messages</button>}
      {shown.map((m, i) => m.role === "user"
        ? <div key={i} className="msg-user small-msg">{m.content}</div>
        : <div key={i} className="msg-ai small-msg"><span className="dot ai" aria-hidden /><div className="msg-body"><Markdown text={m.content} /></div></div>)}
      <div className="history-foot muted">The agent has this whole conversation. Keep going below — your turns are saved back to the project.</div>
    </div>
  );
}

/** The model's reasoning: live (last few lines) while it thinks, then folded into "Thought for Ns". */
function Thinking({ t }: { t: Extract<Item, { kind: "thinking" }> }) {
  const [open, setOpen] = useState(false);
  const live = t.ms === undefined;
  const text = t.text.trim();
  return (
    <div className={`thinking${live ? " live" : ""}`}>
      <button className="thinking-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="spark" aria-hidden>✻</span>
        {live ? "Thinking…" : `Thought for ${fmtTime(Math.max(1000, t.ms!))}`}
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {(open || live) && text && <div className={`thinking-body${open ? "" : " tail"}`}>{open ? text : text.split("\n").filter(Boolean).slice(-3).join("\n")}</div>}
    </div>
  );
}

function ToolRow({ t, waiting, nested }: { t: ToolItem; waiting?: boolean; nested?: boolean }) {
  const meta = TOOLS[t.name] ?? { label: t.name, verb: "Running" };
  const d = t.detail;
  const isCmd = d?.kind === "output" && (t.name === "run_terminal_command" || t.name === "run_app");
  const [open, setOpen] = useState(false);
  const arg = argOf(t);
  const label = t.name === "write_file" && d?.kind === "diff" && d.created ? "Create" : meta.label;
  const sub = t.status === "running" ? (waiting ? "Waiting for approval…" : "Running…")
    : d?.kind === "diff" ? (d.created ? `Created with ${plural(d.added, "line")}` : d.added || d.removed ? [d.added && `Added ${plural(d.added, "line")}`, d.removed && `removed ${plural(d.removed, "line")}`].filter(Boolean).join(", ").replace(/^r/, "R") : "No changes")
    : isCmd && t.summary ? t.summary.replace(/^Ran: [\s\S]*?\((exit code [^)]*)\)$/, "$1")
    : t.summary ?? "";
  const expandable = !!d && !(d.kind === "diff" && !d.lines.length);
  // diffs show inline (like a code review); command output shows its first lines; everything else on click
  const preview = d?.kind === "diff" ? !nested : isCmd;
  return (
    <div className={`trow t-${t.status}${nested ? " nested" : ""}`}>
      <div className="trow-head">
        <span className={`dot ${t.status}`} aria-hidden />
        <button className="trow-title" onClick={() => expandable && setOpen((v) => !v)} aria-expanded={expandable ? open || preview : undefined} disabled={!expandable}>
          <b>{label}</b>{arg && <span className="trow-arg">({short(arg, 80)})</span>}
        </button>
        {FILE_ARG.has(t.name) && t.status === "ok" && arg && <FileLink path={arg} />}
      </div>
      {sub && <div className={`trow-sub${t.status === "error" ? " err" : ""}`}><span className="elbow" aria-hidden>⎿</span><span>{t.status === "error" ? short(sub, 400) : sub}</span></div>}
      {expandable && (open || preview) && (d!.kind === "diff" ? <DiffView d={d!} full={open} /> : <OutputView text={isCmd ? d!.text.replace(/^exit code \S+\n/, "") : d!.text} total={d!.lines - (isCmd && /^exit code /.test(d!.text) ? 1 : 0)} full={open || !isCmd} onMore={() => setOpen(true)} />)}
    </div>
  );
}

function FileLink({ path }: { path: string }) {
  return <OpenFileContext.Consumer>{(open) => open && <button className="icon-btn open-file" title={`Open ${path}`} aria-label={`Open ${path}`} onClick={() => open(path)}>↗</button>}</OpenFileContext.Consumer>;
}

function DiffView({ d, full }: { d: Extract<ToolDetail, { kind: "diff" }>; full: boolean }) {
  const [all, setAll] = useState(full);
  const lines = all ? d.lines : d.lines.slice(0, 14);
  return (
    <div className="diff" role="table" aria-label={`Changes to ${d.path}`}>
      {lines.map((l, i) => l.s === "…" && l.t === " " && l.a === undefined
        ? <div key={i} className="dl gap">⋯</div>
        : <div key={i} className={`dl ${l.t === "+" ? "add" : l.t === "-" ? "del" : ""}`}>
            <span className="ln">{l.t === "-" ? l.a : l.b}</span><span className="sg">{l.t === " " ? "" : l.t}</span><span className="tx">{l.s || " "}</span>
          </div>)}
      {!all && d.lines.length > lines.length && <button className="more" onClick={() => setAll(true)}>Show {d.lines.length - lines.length} more lines</button>}
    </div>
  );
}

function OutputView({ text, total, full, onMore }: { text: string; total: number; full: boolean; onMore: () => void }) {
  const lines = text.replace(/\n+$/, "").split("\n");
  const shown = full ? lines : lines.slice(0, 6);
  // the main process clips long output (ending in "…"); otherwise count what we actually have
  const count = text.endsWith("\n…") ? total : lines.length;
  return (
    <div className="out">
      <pre>{shown.join("\n") || "(no output)"}</pre>
      {!full && count > shown.length && <button className="more" onClick={onMore}>… +{plural(count - shown.length, "line")}</button>}
    </div>
  );
}

function ExploreGroup({ tools }: { tools: ToolItem[] }) {
  const [open, setOpen] = useState(false);
  const n = (names: string[]) => tools.filter((t) => names.includes(t.name)).length;
  const parts = [
    n(["read_file"]) && `read ${plural(new Set(tools.filter((t) => t.name === "read_file").map(argOf)).size, "file")}`,
    n(["grep_search", "codebase_search", "file_search"]) && `searched ${plural(n(["grep_search", "codebase_search", "file_search"]), "time")}`,
    n(["list_dir"]) && `listed ${plural(n(["list_dir"]), "folder")}`,
    n(["inspect_preview"]) && `checked the page${n(["inspect_preview"]) > 1 ? ` ${n(["inspect_preview"])}×` : ""}`,
    n(["app_output"]) && "read app output",
  ].filter(Boolean).join(", ");
  return (
    <div className="trow t-ok group">
      <div className="trow-head">
        <span className="dot ok" aria-hidden />
        <button className="trow-title" onClick={() => setOpen((v) => !v)} aria-expanded={open}><b>Explored</b><span className="trow-arg">{parts.charAt(0).toUpperCase() + parts.slice(1)}</span><span className="chev">{open ? "▾" : "▸"}</span></button>
      </div>
      {open && <div className="group-body">{tools.map((t) => <ToolRow key={t.id} t={t} nested />)}</div>}
    </div>
  );
}

function Approval({ a, tool, onDecide }: { a: Extract<Item, { kind: "approval" }>; tool?: ToolItem; onDecide: (id: string, ok: boolean, all?: boolean) => void }) {
  if (a.decided !== undefined) {
    return <div className={`approval-done ${a.decided ? "ok" : ""}`}>{a.auto ? "Auto-approved" : a.decided ? "Approved" : a.decided === false ? "Skipped" : "Cancelled"}</div>;
  }
  const isApp = tool?.name === "run_app";
  return (
    <div className="approval" role="group" aria-label="Command approval">
      <div className="approval-title">{isApp ? "Start your app?" : "Run this command?"}</div>
      {a.explanation && <div className="muted">{a.explanation}</div>}
      <pre className="cmd"><span className="prompt" aria-hidden>❯ </span>{a.command}</pre>
      <div className="choices">
        <button className="choice primary" onClick={() => onDecide(a.id, true)}><kbd aria-hidden>1</kbd>Run</button>
        <button className="choice" onClick={() => onDecide(a.id, true, true)} title="Run this and every other command until this task finishes"><kbd aria-hidden>2</kbd>Run all for this task</button>
        <button className="choice" onClick={() => onDecide(a.id, false)}><kbd aria-hidden>3</kbd>Skip</button>
      </div>
      <div className="muted small">Press 1, 2 or 3 · Esc to skip</div>
    </div>
  );
}

function Todos({ todos }: { todos: { content: string; status: string }[] }) {
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div className="todos" aria-label="Agent plan">
      <div className="todos-head"><b>Plan</b><span className="muted">{done}/{todos.length}</span>
        <span className="bar"><span style={{ width: `${todos.length ? (done / todos.length) * 100 : 0}%` }} /></span></div>
      {todos.map((t, j) => (
        <div key={j} className={`todo todo-${t.status}`}><span className="box" aria-hidden>{t.status === "completed" ? "✓" : ""}</span><span>{t.content}</span></div>
      ))}
    </div>
  );
}

function StatusLine({ verb, start, turn }: { verb: string; start: number; turn: React.MutableRefObject<{ tokens: number; chars: number }> }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 120); return () => clearInterval(t); }, []);
  const frame = SPIN[Math.floor(now / 120) % SPIN.length];
  const tokens = turn.current.tokens || Math.round(turn.current.chars / 4);
  return (
    <div className="status-line" role="status" aria-label="Agent status">
      <span className="spin" aria-hidden>{frame}</span>
      <span className="verb">{verb}…</span>
      <span className="muted">({fmtTime(Math.max(0, now - start))}{tokens > 0 ? ` · ↓ ${turn.current.tokens ? "" : "~"}${fmtTokens(tokens)} tokens` : ""} · esc to interrupt)</span>
    </div>
  );
}
