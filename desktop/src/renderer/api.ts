// Typed access to the preload bridge.
export interface Entry { name: string; path: string; dir: boolean }
export interface GrepHit { path: string; line: number; text: string }
export type DiffLine = { t: " " | "+" | "-"; s: string; a?: number; b?: number };
export type ToolDetail =
  | { kind: "diff"; path: string; added: number; removed: number; created?: boolean; lines: DiffLine[] }
  | { kind: "output"; text: string; lines: number };
export type AgentEvent =
  | { type: "turn_start"; index: number }
  | { type: "thinking"; delta: string }
  | { type: "waiting"; seconds: number; reason: string }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: any }
  | { type: "tool_end"; id: string; ok: boolean; summary: string; detail?: ToolDetail }
  | { type: "usage"; input: number; output: number }
  | { type: "model"; model: string; task?: string; fallbacks?: string }
  | { type: "network_warning"; providers: string[]; message: string }
  | { type: "synced"; ok: boolean; error?: string }
  | { type: "memory"; scope: "project" | "user"; line: string; added: boolean }
  | { type: "skill"; name: string; scope: "project" | "user" }
  | { type: "skills_used"; names: string[]; auto: boolean }
  | { type: "progress"; id: string; text: string }
  | { type: "file_changed"; path: string }
  | { type: "approval"; id: string; command: string; explanation?: string }
  | { type: "todos"; todos: { content: string; status: string }[] }
  | { type: "done"; stopReason: string }
  | { type: "error"; message: string };
export interface IndexStatus { state: "indexing" | "ready" | "error"; files?: number; chunks?: number; changedFiles?: number; ms?: number; message?: string }
export interface Settings { provider: "anthropic" | "freetoken"; model: string; hasKey: boolean; envKey: boolean; canEncrypt: boolean; ftUrl: string; ftModel: string; hasFtToken: boolean }

type Unsub = () => void;
interface Api {
  pickFolder(): Promise<string | null>;
  openFolder(dir: string): Promise<string>;
  getFolder(): Promise<{ root: string | null; recent: string[] }>;
  list(rel: string): Promise<Entry[]>;
  read(rel: string): Promise<string>;
  write(rel: string, text: string): Promise<void>;
  remove(rel: string): Promise<void>;
  mkdir(rel: string): Promise<void>;
  searchFiles(q: string): Promise<string[]>;
  grep(pattern: string, opts: { caseSensitive?: boolean; fixed?: boolean; glob?: string }): Promise<{ hits: GrepHit[]; truncated: boolean }>;
  reindex(): Promise<void>;
  indexStatus(): Promise<IndexStatus>;
  chat(req: { sessionId: string; mode: "agent" | "ask" | "plan" | "team"; text: string; context?: object; attachments?: ChatAttachment[]; skills?: string[] }): Promise<boolean>;
  pathForFile(f: File): string;
  approve(sid: string, toolId: string, ok: boolean): Promise<void>;
  stop(sid: string): Promise<void>;
  resetChat(sid: string): Promise<void>;
  chatRestore(): Promise<{ sid: string; mode?: string; items: unknown[]; interrupted?: { text: string; mode: string; startedAt: number }; running?: boolean } | null>;
  chatDismissInterrupted(sid: string): Promise<void>;
  notify(title: string, body: string): Promise<void>;
  chatSave(chat: { sid: string; mode: string; items: unknown[] }): Promise<void>;
  pending(sid: string): Promise<string[]>;
  rewind(sid: string, index: number): Promise<string[]>;
  accept(sid: string, rel: string): Promise<void>;
  reject(sid: string, rel: string): Promise<void>;
  original(sid: string, rel: string): Promise<string | null | undefined>;
  cmdK(req: { path: string; language: string; fileText: string; start: number; end: number; instruction: string }): Promise<{ replacement: string; original: string }>;
  complete(id: string, req: { path: string; language: string; prefix: string; suffix: string }): Promise<string>;
  getSettings(): Promise<Settings>;
  setSettings(patch: { provider?: Settings["provider"]; model?: string; apiKey?: string | null; ftUrl?: string; ftModel?: string; ftToken?: string | null }): Promise<void>;
  models(): Promise<string[]>;
  termRun(id: string, command: string): Promise<void>;
  termKill(id: string): Promise<void>;
  appStart(command: string): Promise<void>;
  appStop(): Promise<boolean>;
  appInput(text: string): Promise<void>;
  appStatus(): Promise<AppStatus>;
  previewOpen(url: string): Promise<void>;
  previewReload(): Promise<void>;
  previewExternal(): Promise<void>;
  previewBounds(r: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  ftOpen(route?: string): Promise<void>;
  memoryStatus(): Promise<MemoryStatus>;
  skillsList(): Promise<SkillInfo[]>;
  historyList(): Promise<HistorySnapshot[]>;
  /** Close the open folder: stops the agent, app and anything else working on it. */
  closeFolder(): Promise<void>;
  previewDevice(d: { kind: "desktop" | "phone" | "tablet"; scale?: number }): Promise<void>;
  shareInfo(): Promise<ShareInfo>;
  publishPlan(): Promise<PublishPlan>;
  benchModels(): Promise<string[]>;
  benchLast(): Promise<{ at: number; results: BenchResult[] } | null>;
  benchProgress(): Promise<{ results: BenchResult[]; current: { model: string; task: string } | null } | null>;
  benchScores(): Promise<RouterScores | null>;
  benchStart(models: string[]): Promise<BenchResult[]>;
  benchCancel(): Promise<void>;
  onBenchEvent(fn: (e: { type: "start"; model: string; task: string } | { type: "result"; result: BenchResult } | { type: "done"; results: BenchResult[] }) => void): Unsub;
  androidCheck(): Promise<{ java: { home: string; version: number } | null; sdk: string | null; adb: string | null; problems: string[] }>;
  androidBuild(o: { name: string; appId?: string; build: boolean }): Promise<{ prepared: boolean; apk: string | null; appId: string; webDir: string }>;
  androidInstall(apk: string): Promise<boolean>;
  androidReveal(path: string): Promise<void>;
  androidCancel(): Promise<void>;
  onAndroidLog(fn: (line: string) => void): Unsub;
  publishStart(o: { provider: "cloudflare" | "netlify"; name: string; build: string | null; dir: string }): Promise<{ provider: string; name: string; url: string; at: number; qr: string }>;
  publishCancel(): Promise<void>;
  onPublishLog(fn: (line: string) => void): Unsub;
  shareTunnelStart(): Promise<{ status: "on" | "error" | "off" | "starting"; url?: string; via?: string; message?: string; qr: string | null }>;
  shareTunnelStop(): Promise<void>;
  zoom(step: number): void;
  shareTunnelState(): Promise<{ status: "on" | "error" | "off" | "starting"; url?: string; via?: string; message?: string; qr: string | null }>;
  onShareTunnel(fn: (s: { status: "on" | "error" | "off" | "starting"; url?: string; via?: string; message?: string; qr: string | null }) => void): Unsub;
  historyRestore(id: string): Promise<{ restored: number; removed: string[]; files: string[] }>;
  skillsInstall(source: string): Promise<{ source: string; installed: { name: string; files: number; skipped: number }[]; readme: string }>;
  skillsRemove(name: string): Promise<void>;
  skillsOpen(name: string): Promise<void>;
  videoExport(file: string, opts?: { fps?: number; width?: number; height?: number; duration?: number }): Promise<{ file: string; bytes: number; frames: number; duration: number; ext: string; errors: string[] }>;
  videoReply(r: { id: number; ok: boolean; value?: unknown; error?: string }): void;
  onVideoEncode(fn: (m: { id: number; op: "begin" | "frame" | "end" | "abort"; payload?: any }) => void): Unsub;
  onVideoProgress(fn: (p: { done: number; total: number }) => void): Unsub;
  teamSnapshot(sid: string): Promise<TeamSnapshot>;
  teamStop(sid: string, name?: string): Promise<string>;
  onTeamEvent(fn: (s: TeamSnapshot) => void): Unsub;
  remember(fact: string, scope: "project" | "user"): Promise<{ file: string; added: boolean; line: string }>;
  openMemory(scope: "project" | "user"): Promise<string | null>;
  ftHub(): Promise<FtHub>;
  ftStartServer(): Promise<string>;
  ftCreateProject(name: string): Promise<{ id: string; name: string }>;
  ftUseModel(model: string): Promise<boolean>;
  ftWebsite(route?: string): Promise<void>;
  ftOpenProject(id: string): Promise<void>;
  ftNav(what: "back" | "reload" | "external" | "home"): Promise<void>;
  ftBounds(r: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  ftTakeProject(): Promise<FtProject | null>;
  ftContinue(sid: string, projectId: string): Promise<boolean>;
  onAgentEvent(fn: (p: { sessionId: string; event: AgentEvent }) => void): Unsub;
  onFsChanged(fn: (paths: string[]) => void): Unsub;
  onIndexStatus(fn: (s: IndexStatus) => void): Unsub;
  onFolderOpened(fn: (root: string) => void): Unsub;
  onTermData(fn: (p: { id: string; data: string }) => void): Unsub;
  onTermExit(fn: (p: { id: string; code: number | null }) => void): Unsub;
  onAppEvent(fn: (e: AppEvent) => void): Unsub;
  onPreviewOpen(fn: (url: string) => void): Unsub;
  onPreviewState(fn: (s: PreviewState) => void): Unsub;
  onFtViewOpen(fn: (route: string) => void): Unsub;
  onFtViewClose(fn: () => void): Unsub;
  onFtViewState(fn: (s: FtViewState) => void): Unsub;
  onFtViewError(fn: (message: string) => void): Unsub;
  onFtProject(fn: (p: { id: string; name: string }) => void): Unsub;
  onFtServer(fn: (state: string) => void): Unsub;
  onSettingsChanged(fn: () => void): Unsub;
}
export type AppStatus = { running: boolean; command: string; url?: string; exitCode?: number | null; output: string };
export type AppEvent = { type: "start"; command: string } | { type: "data"; data: string } | { type: "url"; url: string } | { type: "exit"; code: number | null };
export type PreviewState = { url: string; title: string; loading: boolean };
export type FtProject = { id: string; name: string; model: string; origin: string; messages: { role: "user" | "assistant"; content: string; provider?: string | null }[] };
type MemoryFile = { file: string | null; exists: boolean; lines: number; entries: number };
export type TeamAgent = { sid: string; name: string; task: string; status: "queued" | "running" | "waiting" | "done" | "failed" | "stopped"; activity: string; files: string[]; report: string; question?: string; reviewer?: boolean; model?: string };
export type TeamSnapshot = { supervisor: string; agents: TeamAgent[] };
export type ChatAttachment = { name: string; mime?: string; data?: string; path?: string };
export type BenchResult = { model: string; task: string; ok: boolean; why: string | null; ms: number; steps: number; tokens: number };
export type RouterScores = { task: string; models: { model: string; tier: string; quality: number; learned: number; score: number }[] };
export type PublishPlan = { name: string; build: string | null; dir: string | null; server: string | null; last: { provider: string; name: string; url: string; at: number } | null; problem: string | null };
export type ShareInfo = { url: string | null; lan: string | null; reachable: boolean; qr: string | null; advice: string | null; addresses: string[] };
export type HistorySnapshot = { id: string; time: number; label: string; files: number };
export type SkillInfo = { name: string; description: string; scope: "user" | "project" | "builtin"; dir: string | null; source?: string };
export type MemoryStatus = { project: MemoryFile; user: MemoryFile };
export type FtHub = {
  origin: string; state: "connected" | "no-token" | "bad-token" | "offline"; error?: string; canStart: boolean;
  model: string; provider: "anthropic" | "freetoken";
  projects: { id: string; name: string; updatedAt: string | null }[];
  usage: { requests: number; tokens: number; remaining: number; tokensEstimated: boolean; remainingLive: boolean; overall: { used: number; limit: number; limits: number; resetAt: string } | null;
    providers: { id: string; name: string; status: string; requests: number; used: number | null; limit: number | null; models: number }[] } | null;
  models: string[];
};
export type FtViewState = { url: string; title: string; loading: boolean; canGoBack: boolean };
export const api = (window as unknown as { api: Api }).api;
