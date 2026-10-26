import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, shell, Tray, WebContentsView } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as ai from "./ai";
import * as ft from "./ai-freetoken";
import * as index from "./indexer";
import * as link from "./freetoken-link";
import * as memory from "./memory";
import * as runner from "./runner";
import * as history from "./history";
import * as share from "./share";
import * as publisher from "./publish";
import * as android from "./android";
import * as bench from "./bench";
import * as skills from "./skills";
import * as team from "./team";
import * as chats from "./chats";
import * as video from "./video";
import * as web from "./web";
import { fuzzyFiles, grep } from "./search";
import { deletePath, getRoot, isIgnored, listDir, readText, reloadIgnore, resolveInRoot, setRoot, writeText, clearRoot } from "./workspace";

if (process.env.CURSOR_REMAKE_USER_DATA) app.setPath("userData", process.env.CURSOR_REMAKE_USER_DATA);
else migrateProfile();
// Windows groups taskbar buttons (and picks their icon) by this id
if (process.platform === "win32") app.setAppUserModelId("V-Run");

/** V-Run used to be called cursor-remake: carry its settings (and the key that decrypts them) over once. */
function migrateProfile() {
  const now = app.getPath("userData"), old = path.join(app.getPath("appData"), "cursor-remake");
  if (fs.existsSync(path.join(now, "settings.json")) || !fs.existsSync(path.join(old, "settings.json"))) return;
  try {
    fs.mkdirSync(now, { recursive: true });
    for (const f of ["settings.json", "Local State"]) if (fs.existsSync(path.join(old, f))) fs.copyFileSync(path.join(old, f), path.join(now, f));
  } catch { /* start fresh */ }
}

// vrun://project/<id> links ("Continue in V-Run" on FreeToken) open here; one V-Run window handles them all.
const PROTOCOL = "vrun";
const isTest = !!process.env.CURSOR_REMAKE_USER_DATA;
if (!isTest) {
  if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1] ?? ".")]);
  else app.setAsDefaultProtocolClient(PROTOCOL);
}
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", (_e, argv) => {
  // shown too — V-Run may be hidden in the tray (working in the background), not just minimised
  if (win) showWindow();
  const url = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (url) handleDeepLink(url);
});
app.on("open-url", (e, url) => { e.preventDefault(); handleDeepLink(url); }); // macOS

// ---------------------------------------------------------------- settings
interface Settings {
  provider: "anthropic" | "freetoken";
  model: string; apiKeyEnc?: string;
  ftUrl: string; ftModel: string; ftTokenEnc?: string;
  recent: string[];
}
const DEFAULTS: Settings = { provider: "anthropic", model: ai.DEFAULT_MODEL, ftUrl: ft.FREETOKEN_DEFAULT_URL, ftModel: "auto-smart", recent: [] };
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) }; }
  catch { return { ...DEFAULTS }; }
}
let settings = loadSettings();
const saveSettings = () => { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); };
const decrypt = (enc?: string) => {
  if (!enc || !safeStorage.isEncryptionAvailable()) return "";
  try { return safeStorage.decryptString(Buffer.from(enc, "base64")); } catch { return ""; }
};
const encrypt = (v: string) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is unavailable on this system.");
  return safeStorage.encryptString(v.trim()).toString("base64");
};
const storedKey = () => decrypt(settings.apiKeyEnc);
const ftToken = () => decrypt(settings.ftTokenEnc) || process.env.FREETOKEN_API_TOKEN || "";
ai.configure({ apiKey: () => storedKey() || process.env.ANTHROPIC_API_KEY || "", model: () => settings.model || ai.DEFAULT_MODEL });
/** The FreeToken API base (…/api/v1): env override, else Settings. Everything FreeToken-related uses this. */
const ftBase = () => process.env.FREETOKEN_URL || settings.ftUrl || ft.FREETOKEN_DEFAULT_URL;
// the agent's web_search goes through FreeToken's Tavily search when the user connected a key there
web.setFreeTokenSearch(async (query) => {
  const token = ftToken();
  if (!token) return null;
  const res = await fetch(`${new URL(ftBase()).origin}/api/web/search`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!res?.ok) return null; // no Tavily key connected (400) or FreeToken not running: other engines take over
  const j = (await res.json()) as { answer?: string | null; hits?: { title: string; url: string; snippet: string }[] };
  const hits = j.hits ?? [];
  return j.answer ? [{ title: "Summary", url: hits[0]?.url ?? "", snippet: j.answer }, ...hits] : hits;
});
ft.configureFreeToken({ url: ftBase, token: ftToken, model: () => settings.ftModel || "auto-smart" });
// the agent must never take over or stop the FreeToken server it runs on (when that's on this machine)
runner.setProtectedPorts(() => {
  try {
    const u = new URL(ftBase());
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) return [];
    return [{ port: Number(u.port || (u.protocol === "https:" ? 443 : 80)), name: "FreeToken" }];
  } catch { return []; }
});
const useFreeToken = () => (process.env.CURSOR_REMAKE_PROVIDER ?? settings.provider) === "freetoken";
const errorText = (e: unknown) => (useFreeToken() ? ft.describeFreeTokenError(e) : ai.describeError(e));

// ---------------------------------------------------------------- window
let win: BrowserWindow | null = null;
// late events (a debounced file-watch flush, a stream finishing) can arrive after the window has closed
const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
};

// ---------------------------------------------------------------- tasks that outlive the window
// Closing the window while the agent works asks whether to keep going in the background (a tray icon
// stays; a notification says when it's done). Finished or stuck tasks notify when V-Run isn't in front.
const runningTasks = new Map<string, string>(); // chat session → its request
let tray: Tray | null = null;
let quitting = false;
const iconPath = () => path.join(__dirname, "../../assets", process.platform === "win32" ? "icon.ico" : "icon.png");

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function notify(title: string, body: string) {
  if (isTest || !Notification.isSupported()) return;
  const n = new Notification({ title, body: body.slice(0, 240), icon: iconPath(), silent: false });
  n.on("click", showWindow);
  n.show();
}
const inFront = () => !!win && win.isVisible() && win.isFocused();
function ensureTray() {
  if (tray) return;
  tray = new Tray(iconPath());
  tray.setToolTip("V-Run");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show V-Run", click: showWindow },
    { type: "separator" },
    { label: "Stop and quit V-Run", click: () => { for (const sid of runningTasks.keys()) ai.stop(sid); quitting = true; app.quit(); } },
  ]));
  tray.on("click", showWindow);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 800, minHeight: 500,
    backgroundColor: "#1e1e1e", title: "V-Run", icon: path.join(__dirname, "../../assets", process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: { preload: path.join(__dirname, "../preload/preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.on("closed", () => { win = null; });
  win.on("close", (e) => {
    if (quitting || !runningTasks.size || isTest) return;
    e.preventDefault();
    const [first] = runningTasks.values();
    const choice = dialog.showMessageBoxSync(win!, {
      type: "question", title: "V-Run", message: "The agent is still working",
      detail: `"${first.slice(0, 160)}"${runningTasks.size > 1 ? ` and ${runningTasks.size - 1} more` : ""}\n\nIt can finish in the background — V-Run stays in the tray and tells you when it's done.`,
      buttons: ["Keep working in the background", "Stop it and quit", "Cancel"], defaultId: 0, cancelId: 2, noLink: true,
    });
    if (choice === 0) {
      win!.hide();
      ensureTray();
      notify("V-Run is still working", "It'll tell you when the task is done. Click the tray icon to open it.");
    } else if (choice === 1) {
      for (const sid of runningTasks.keys()) ai.stop(sid);
      quitting = true;
      win!.close();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL + (isTest ? "?intro=0" : ""));
  else win.loadFile(path.join(__dirname, "../renderer/index.html"), isTest ? { query: { intro: "0" } } : undefined);
}

// ---------------------------------------------------------------- workspace + watcher
let watcher: fs.FSWatcher | null = null;
let changedBuf = new Set<string>();
let changeTimer: NodeJS.Timeout | undefined;
let indexTimer: NodeJS.Timeout | undefined;

/**
 * Leaving a project (another folder opened, or the folder closed): the agent and its team, a benchmark,
 * the app and any share link stop — nothing keeps changing or serving a project that isn't open.
 */
function leaveProject() {
  for (const sid of [...runningTasks.keys()]) { team.stopAgent(sid); ai.stop(sid); }
  bench.cancelBenchmark();
  runner.stopApp();
  share.stopTunnel();
}

async function openFolder(dir: string) {
  const same = getRoot() && path.resolve(dir).toLowerCase() === path.resolve(getRoot()!).toLowerCase();
  if (same) runner.stopApp(); // reopening the same folder: just restart cleanly
  else leaveProject();
  setRoot(dir);
  const root = getRoot()!;
  settings.recent = [root, ...settings.recent.filter((r) => r !== root)].slice(0, 8);
  saveSettings();
  watcher?.close();
  watcher = fs.watch(root, { recursive: true }, (_ev, file) => {
    if (!file) return;
    const rel = file.toString().split(path.sep).join("/");
    if (rel.startsWith(".git/") || rel.includes("node_modules/")) return;
    if (/(^|\/)\.(git|cursor)ignore$/.test(rel)) reloadIgnore();
    if (isIgnored(rel)) return;
    changedBuf.add(rel);
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => { send("fs-changed", [...changedBuf]); changedBuf = new Set(); }, 150);
    if (!rel.startsWith(".v-run/")) schedulePreviewReload();
    clearTimeout(indexTimer);
    indexTimer = setTimeout(() => runIndex(), 2500);
  });
  win?.setTitle(`${path.basename(root)} — V-Run`);
  runIndex();
  send("folder-opened", root);
  return root;
}

let indexing = false;
// the latest status is kept so a workbench that mounts after indexing finished still shows it
let indexStatus: Record<string, unknown> = { state: "indexing" };
const setIndexStatus = (s: Record<string, unknown>) => { indexStatus = s; send("index-status", s); };
async function runIndex() {
  if (indexing || !getRoot()) return;
  indexing = true;
  setIndexStatus({ state: "indexing" });
  try { setIndexStatus({ state: "ready", ...(await index.reindex()) }); }
  catch (e) { setIndexStatus({ state: "error", message: (e as Error).message }); }
  finally { indexing = false; }
}

// ---------------------------------------------------------------- terminal panel
const terms = new Map<string, ChildProcess>();
function termRun(id: string, command: string) {
  const root = getRoot();
  if (!root) throw new Error("Open a folder first");
  const shellBin = process.platform === "win32" ? runner.windowsShell() : "/bin/bash";
  const args = process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-lc", command];
  const p = spawn(shellBin, args, { cwd: root, env: process.env, windowsHide: true });
  terms.set(id, p);
  p.stdout?.on("data", (d) => send("term-data", { id, data: d.toString() }));
  p.stderr?.on("data", (d) => send("term-data", { id, data: d.toString() }));
  p.on("error", (e) => send("term-data", { id, data: `\n${e.message}\n` }));
  p.on("close", (code) => { terms.delete(id); send("term-exit", { id, code }); });
}

// ---------------------------------------------------------------- app runner + preview pane
// The preview is a sandboxed WebContentsView laid over the renderer's preview box (the renderer
// reports the box's bounds, or null while it's hidden or a dialog covers it). It gets its own
// session partition, so the user's app can't touch the editor's storage.
let preview: WebContentsView | null = null;
// a page served from this computer reloads (without cache) when the project's files change, so the
// preview never shows an outdated version; dev servers with their own hot reload are unaffected
let previewReloadTimer: ReturnType<typeof setTimeout> | undefined;
function schedulePreviewReload() {
  clearTimeout(previewReloadTimer);
  previewReloadTimer = setTimeout(() => {
    const wc = preview?.webContents;
    const url = wc && !wc.isDestroyed() ? wc.getURL() : "";
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)|^file:/i.test(url) && !wc!.isLoading()) wc!.reloadIgnoringCache();
  }, 700);
}
let previewConsole: string[] = [];
let previewShown = false;
// where the renderer wants the preview (CSS px), or null when it's hidden
let previewWanted: { x: number; y: number; width: number; height: number } | null = null;
function applyPreviewBounds() {
  previewShown = !!previewWanted;
  if (!preview) return;
  // the renderer measures in CSS px; the view is placed in window DIPs, which differ when the UI is zoomed (Ctrl+= / Ctrl+-)
  const z = win?.webContents.getZoomFactor() ?? 1;
  const r = previewWanted;
  if (r) preview.setBounds({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.round(r.width * z), height: Math.round(r.height * z) });
  preview.setVisible(previewShown);
}

// what the preview tells sites it is, per device (a real phone/tablet browser, so sites serve their mobile layout)
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
const TABLET_UA = "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
let desktopUA = "";
let emulating = false;

function ensurePreview() {
  if (preview) return preview;
  const v = new WebContentsView({ webPreferences: { partition: "persist:preview", sandbox: true, contextIsolation: true, nodeIntegration: false } });
  v.setVisible(false);
  win!.contentView.addChildView(v);
  const wc = v.webContents;
  desktopUA = wc.getUserAgent();
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) wc.loadURL(url).catch(() => {}); return { action: "deny" }; });
  wc.on("console-message", (e: any, legacyLevel?: number, legacyMessage?: string, _line?: number, legacySource?: string) => {
    const level = typeof e?.level === "string" ? e.level : ["verbose", "info", "warning", "error"][legacyLevel ?? 1];
    previewConsole.push(runner.consoleLine(level, String(e?.message ?? legacyMessage), e?.sourceId ?? legacySource));
    if (previewConsole.length > 200) previewConsole.shift();
  });
  const state = () => send("preview-state", { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading() });
  for (const ev of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) wc.on(ev as "did-stop-loading", state);
  wc.on("did-fail-load", (_e, code, desc, url, isMain) => { if (isMain && code !== -3) previewConsole.push(`[error] Failed to load ${url}: ${desc}`); });
  wc.on("render-process-gone", (_e, d) => previewConsole.push(`[error] The page crashed (${d.reason})`));
  preview = v;
  applyPreviewBounds();
  return v;
}

// Video export encodes in the window (WebCodecs): a small request/reply channel to it.
const encodeCalls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let encodeSeq = 0;
function encodeCall<T>(op: string, payload?: unknown): Promise<T> {
  if (!win || win.isDestroyed()) return Promise.reject(new Error("Video export needs the V-Run window to be open."));
  const id = ++encodeSeq;
  return new Promise<T>((resolve, reject) => {
    encodeCalls.set(id, { resolve, reject });
    send("video-encode", { id, op, payload });
  });
}
// Team mode: workers run the same agent loop as the chat, under their own session ids
const saveMemory = (sid: string) => {
  try { chats.saveAgent(sid, { claude: ai.getSession(sid).messages, ft: ft.getTranscript(sid), skills: [...ai.getSession(sid).skills] }); }
  catch (e) { console.error("saving the chat failed", e); }
};
// the team is saved as it changes (at most once a second per chat), its agents' memories when they finish
const teamSaves = new Map<string, NodeJS.Timeout>();
const saveTeamSoon = (supervisor: string) => {
  if (teamSaves.has(supervisor)) return;
  teamSaves.set(supervisor, setTimeout(() => {
    teamSaves.delete(supervisor);
    const saved = team.exportTeam(supervisor);
    if (saved) try { chats.saveTeam(supervisor, saved); } catch (e) { console.error("saving the team failed", e); }
  }, 1000));
};
team.configureTeam({
  run: (req, emit) => {
    const done = (e: ai.AgentEvent) => { emit(e); if (e.type === "done") saveMemory(req.sessionId); };
    return useFreeToken() ? ft.chatFreeToken(req, done) : ai.chat(req, done);
  },
  stop: (sid) => ai.stop(sid),
  getSession: (sid) => ai.getSession(sid),
  forward: (sid, event) => send("agent-event", { sessionId: sid, event }),
  onTeam: (supervisor, snapshot) => { send("team-event", snapshot); saveTeamSoon(supervisor); },
});

video.setEncoderHost({
  begin: (cfg) => encodeCall("begin", cfg),
  frame: (bgra) => encodeCall("frame", bgra),
  end: () => encodeCall("end"),
  abort: () => { encodeCall("abort").catch(() => {}); },
});

runner.setPreviewHost({
  async open(url) {
    const v = ensurePreview();
    previewConsole = [];
    send("preview-open", url);
    // always the latest version: no cached pages, scripts or styles from an earlier run
    await v.webContents.session.clearCache().catch(() => {});
    try { await v.webContents.loadURL(url, { extraHeaders: "pragma: no-cache\ncache-control: no-cache\n" }); } catch (e) { return (e as Error).message; }
  },
  async reload() {
    // the page already shown, fresh from disk — quietly: the preview pane isn't re-opened or re-laid out
    const wc = preview?.webContents;
    if (!wc?.getURL()) return "Nothing is open in the preview.";
    previewConsole = [];
    await wc.session.clearCache().catch(() => {});
    return new Promise<string | void>((resolve) => {
      const done = () => { wc.off("did-fail-load", failed); resolve(); };
      const failed = (_e: unknown, code: number, desc: string) => { if (code !== -3) { wc.off("did-finish-load", done); resolve(desc || `error ${code}`); } };
      wc.once("did-finish-load", done);
      wc.on("did-fail-load", failed);
      wc.reloadIgnoringCache();
    });
  },
  async inspect() {
    const wc = preview?.webContents;
    if (!wc?.getURL()) return null;
    const info = await wc.executeJavaScript(`({ title: document.title, text: document.body ? document.body.innerText.slice(0, 20000) : "" })`)
      .catch(() => ({ title: wc.getTitle(), text: "" })) as { title: string; text: string };
    let jpeg: Buffer | undefined;
    if (previewShown) {
      const img = await wc.capturePage().catch(() => null);
      if (img && !img.isEmpty()) jpeg = (img.getSize().width > 1280 ? img.resize({ width: 1280 }) : img).toJPEG(70);
    }
    return { url: wc.getURL(), title: info.title, text: info.text, console: previewConsole.slice(-40), jpeg };
  },
  async evaluate(script) {
    const wc = preview?.webContents;
    if (!wc?.getURL()) return "Nothing is open in the preview.";
    return wc.executeJavaScript(runner.probeScript(script)).then(String, (e: Error) => `Error: ${e.message}`);
  },
  async setWidth(width) {
    // the page laid out as on a phone of that width (media queries respond), then back to the pane's own size
    const wc = preview?.webContents;
    if (!wc) return;
    if (width) wc.enableDeviceEmulation({ screenPosition: "mobile", screenSize: { width, height: 800 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 0, viewSize: { width, height: 800 }, scale: 1 });
    else wc.disableDeviceEmulation();
    await new Promise((r) => setTimeout(r, 400)); // let it lay out again
  },
});
runner.onRunEvent((e) => send("app-event", e));

// ---------------------------------------------------------------- FreeToken inside V-Run
// The FreeToken web app in its own WebContentsView over the editor area (same bounds dance as the
// preview), with a persistent session so the user signs in once. Pages get window.vrun from the
// freetoken-bridge preload; navigating off the FreeToken origin opens the system browser instead.
let ftView: WebContentsView | null = null;
let ftShown = false;
const ftOrigin = () => link.originOf(ftBase());
const ftRoot = link.serverRoot(__dirname);

function ensureFtView() {
  if (ftView) return ftView;
  const v = new WebContentsView({ webPreferences: {
    partition: "persist:freetoken", sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(__dirname, "../preload/freetoken-bridge.js"),
  } });
  v.setVisible(false);
  win!.contentView.addChildView(v);
  const wc = v.webContents;
  const external = (url: string) => { if (/^https?:/i.test(url)) shell.openExternal(url); };
  wc.setWindowOpenHandler(({ url }) => { external(url); return { action: "deny" }; });
  wc.on("will-navigate", (e, url) => { try { if (new URL(url).origin !== ftOrigin()) { e.preventDefault(); external(url); } } catch { e.preventDefault(); } });
  const state = () => send("ft-view-state", { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(), canGoBack: wc.navigationHistory.canGoBack() });
  for (const ev of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) wc.on(ev as "did-stop-loading", state);
  ftView = v;
  return v;
}

/** Show a FreeToken page (starting the server next door first if it isn't up). */
async function openFtPage(route = "/") {
  send("ft-view-open", route);
  const origin = ftOrigin();
  const how = await link.ensureServer(origin, ftRoot, () => {}).catch((e: Error) => { send("ft-view-error", e.message); throw e; });
  if (how === "started") send("ft-server", "started");
  await ensureFtView().webContents.loadURL(origin + (route.startsWith("/") ? route : `/${route}`));
}

// a project handed over from FreeToken, waiting for the (re)mounted chat panel to pick it up
const projects = new Map<string, link.FreeTokenProject>();
let pendingProject: link.FreeTokenProject | null = null;
const chatLinks = new Map<string, string>(); // chat session → FreeToken project id

/** Sign V-Run in to the FreeToken next door on its own (no-op when connected or not local). */
async function tryAutoConnect() {
  if (ftToken()) return true;
  if (!ftRoot || isTest && !process.env.VRUN_ALLOW_AUTOCONNECT) return false;
  const origin = ftOrigin();
  if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return false;
  const token = await link.autoConnect(origin, ftRoot);
  if (!token) return false;
  settings.ftTokenEnc = encrypt(token);
  settings.provider = "freetoken";
  saveSettings();
  send("settings-changed", null);
  return true;
}

async function openFreeTokenProject(id: string) {
  if (!ftToken()) await link.ensureServer(ftOrigin(), ftRoot).then(tryAutoConnect).catch(() => false);
  if (!ftToken()) {
    openFtPage("/v-run").catch(() => {});
    throw new Error("Connect V-Run to FreeToken first — the sign-in page is open in V-Run.");
  }
  await link.ensureServer(ftOrigin(), ftRoot);
  const p = await link.loadProject(ftBase(), ftToken(), id, { root: process.env.VRUN_PROJECTS_DIR || undefined });
  projects.set(id, p);
  pendingProject = p;
  const sameFolder = !!getRoot() && path.resolve(getRoot()!) === path.resolve(p.dir);
  await openFolder(p.dir);
  // a new folder remounts the workbench and its chat takes the project on mount; telling the old,
  // about-to-unmount chat would let it grab the project first
  if (sameFolder) send("ft-project", { id: p.id, name: p.name });
  // shown too — V-Run may be hidden in the tray (working in the background), not just minimised
  if (win) showWindow();
}

let pendingLink: string | null = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`)) ?? null;
function handleDeepLink(url: string) {
  if (!win) { pendingLink = url; return; } // cold start: handled once the window has loaded
  const d = link.parseDeepLink(url);
  if (d?.kind !== "project") return; // vrun://open only needed the window, which is up and focused
  openFreeTokenProject(d.id).catch((e) => dialog.showMessageBox(win!, { type: "warning", title: "V-Run", message: "Couldn't open the FreeToken project", detail: (e as Error).message }));
}

/** Only the FreeToken view, on the FreeToken origin, may use the bridge. */
function fromFreeToken(e: Electron.IpcMainInvokeEvent) {
  try { return !!ftView && e.sender === ftView.webContents && new URL(e.senderFrame?.url ?? "").origin === ftOrigin(); } catch { return false; }
}

// ---------------------------------------------------------------- IPC
const completions = new Map<string, AbortController>();
const handle = (ch: string, fn: (...args: any[]) => unknown) =>
  ipcMain.handle(ch, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: errorText(e) }; }
  });

function registerIpc() {
  handle("folder:pick", async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ["openDirectory"] });
    return r.canceled ? null : openFolder(r.filePaths[0]);
  });
  handle("folder:open", (dir: string) => openFolder(dir));
  handle("folder:get", () => ({ root: getRoot(), recent: settings.recent }));
  handle("fs:list", (rel: string) => listDir(rel));
  handle("fs:read", (rel: string) => readText(rel));
  handle("fs:write", (rel: string, text: string) => writeText(rel, text));
  handle("fs:delete", (rel: string) => deletePath(rel));
  handle("fs:mkdir", (rel: string) => fs.promises.mkdir(resolveInRoot(rel).abs, { recursive: true }));
  handle("search:files", (q: string) => fuzzyFiles(q, 50));
  handle("search:grep", (pattern: string, opts: { caseSensitive?: boolean; fixed?: boolean; glob?: string }) => grep(pattern, { ...opts, max: 500 }));
  handle("index:run", () => runIndex());
  handle("index:stats", () => index.lastStats);
  handle("index:status", () => indexStatus);
  handle("index:search", (q: string) => index.search(q, 20));

  handle("ai:chat", (req: ai.ChatRequest) => {
    // a benchmark has the workspace (it runs in throwaway projects): no chat tasks meanwhile
    if (bench.benchmarkRunning()) {
      send("agent-event", { sessionId: req.sessionId, event: { type: "error", message: "A model benchmark is running — wait for it to finish, or cancel it in /benchmark." } });
      send("agent-event", { sessionId: req.sessionId, event: { type: "done", stopReason: "error" } });
      return true;
    }
    let emit = (event: ai.AgentEvent) => send("agent-event", { sessionId: req.sessionId, event });
    // a chat continuing a FreeToken project writes each finished turn back to the project
    const projectId = chatLinks.get(req.sessionId);
    if (projectId) {
      const raw = emit;
      let answer = "";
      emit = (event) => {
        if (event.type === "text") answer += event.delta;
        raw(event);
        if (event.type === "done" && event.stopReason !== "error")
          link.syncTurn(ftBase(), ftToken(), projectId, req.text, answer)
            .then(() => raw({ type: "synced", ok: true }))
            .catch((e: Error) => raw({ type: "synced", ok: false, error: e.message }));
      };
    }
    // after every turn, save what the agent remembers so a reload or restart picks up where it was
    const turnEmit = emit;
    emit = (event) => {
      turnEmit(event);
      if (event.type === "done") saveMemory(req.sessionId);
    };
    // a snapshot before the agent changes anything and one after: the History panel can put either back
    const acts = req.mode === "agent" || req.mode === "team";
    const root = getRoot();
    const afterEmit = emit;
    emit = (event) => {
      afterEmit(event);
      if (event.type === "done" && acts) history.snapshot(root, `After: ${req.text}`).catch(() => {});
      if (event.type === "done") {
        runningTasks.delete(req.sessionId);
        chats.markRunning(req.sessionId, null);
        // tell the user when V-Run isn't in front: done, stopped on an error, or out of steps
        if (!inFront() && event.stopReason !== "aborted") {
          const what = req.text.replace(/\s+/g, " ").slice(0, 120);
          const title = event.stopReason === "error" ? "V-Run stopped on an error" : event.stopReason === "max_turns" ? "V-Run ran out of steps" : "V-Run finished";
          notify(title, `${what}${!win?.isVisible() && !runningTasks.size ? "\nNothing else is running — click to open V-Run." : ""}`);
        }
      }
    };
    // long tasks: the agent's memory is saved every few steps, so a crash or restart mid-task loses little
    let steps = 0;
    const duringEmit = emit;
    emit = (event) => {
      duringEmit(event);
      if (event.type === "tool_end" && ++steps % 5 === 0) saveMemory(req.sessionId);
    };
    runningTasks.set(req.sessionId, req.text);
    chats.markRunning(req.sessionId, { text: req.text, mode: req.mode, startedAt: Date.now() });
    (acts ? history.snapshot(root, `Before: ${req.text}`).catch(() => null) : Promise.resolve(null))
      .then(() => (useFreeToken() ? ft.chatFreeToken(req, emit) : ai.chat(req, emit)));
    return true;
  });
  // the chat panel takes over a project FreeToken handed us: seed the agent with the conversation
  handle("ft:take-project", () => {
    const p = pendingProject;
    pendingProject = null;
    return p && { id: p.id, name: p.name, model: p.model, messages: p.messages, origin: p.origin };
  });
  handle("ft:continue", (sid: string, projectId: string) => {
    const p = projects.get(projectId);
    if (!p) throw new Error("That project isn't loaded any more — open it again from FreeToken.");
    const intro = `[This conversation started in the FreeToken project "${p.name}" and continues here in V-Run, in the project's folder (${p.dir}). Earlier messages follow; pick up where they left off.]`;
    const turns = ai.seedSession(sid, p.messages, intro);
    ft.seedFreeToken(sid, turns);
    chatLinks.set(sid, p.id);
    return true;
  });
  handle("ft:open", (route?: string) => openFtPage(route));
  // V.md memory
  handle("memory:status", () => memory.memoryStatus());
  // skills
  handle("skills:list", () => skills.listSkills());
  handle("skills:install", (source: string) => skills.installFromGitHub(String(source)));
  handle("skills:remove", (name: string) => skills.removeSkill(String(name)));
  handle("skills:open", async (name: string) => {
    const s = (await skills.listSkills()).find((x) => x.name === name);
    if (s?.dir) await shell.openPath(path.join(s.dir, "SKILL.md"));
  });
  // video export: the window answers encode requests here
  ipcMain.on("video-encode-reply", (_e, r: { id: number; ok: boolean; value?: unknown; error?: string }) => {
    const c = encodeCalls.get(r.id);
    if (!c) return;
    encodeCalls.delete(r.id);
    if (r.ok) c.resolve(r.value); else c.reject(new Error(r.error || "Encoding failed."));
  });
  handle("video:export", (file: string, opts?: { fps?: number; width?: number; height?: number; duration?: number }) => {
    const p = resolveInRoot(String(file)).abs;
    return video.exportVideo(p, { ...(opts ?? {}), onProgress: (done, total) => send("video-progress", { done, total }) });
  });
  handle("memory:remember", (fact: string, scope: memory.Scope) => memory.remember(String(fact), scope === "user" ? "user" : "project"));
  handle("memory:open", async (scope: memory.Scope) => {
    const file = await memory.ensureMemoryFile(scope === "user" ? "user" : "project");
    // the project's V.md opens in the editor (the renderer gets its path); the personal one in the OS editor
    if (scope === "user") { await shell.openPath(file); return null; }
    return "V.md";
  });
  // the hub: V-Run's own FreeToken tab (the full website stays in the browser)
  handle("ft:hub", async () => {
    const origin = ftOrigin();
    if (!(await link.isUp(origin))) return { origin, state: "offline", canStart: !!ftRoot, projects: [], usage: null, models: [], model: settings.ftModel, provider: useFreeToken() ? "freetoken" : "anthropic" };
    await tryAutoConnect();
    return { ...(await link.hubData(ftBase(), ftToken())), canStart: !!ftRoot, model: settings.ftModel, provider: useFreeToken() ? "freetoken" : "anthropic" };
  });
  handle("ft:start-server", () => link.ensureServer(ftOrigin(), ftRoot));
  handle("ft:create-project", async (name: string) => {
    const p = await link.createProject(ftBase(), ftToken(), String(name).trim().slice(0, 80));
    await openFreeTokenProject(p.id);
    return p;
  });
  handle("ft:use-model", (model: string) => {
    settings.ftModel = String(model);
    settings.provider = "freetoken";
    saveSettings();
    send("settings-changed", null);
    return true;
  });
  handle("ft:website", (route?: string) => shell.openExternal(ftOrigin() + (route && route.startsWith("/") ? route : "/")));
  handle("ft:open-project", (id: string) => openFreeTokenProject(id));
  handle("ft:nav", (what: "back" | "reload" | "external" | "home") => {
    const wc = ftView?.webContents;
    if (what === "home") return openFtPage("/");
    if (!wc) return;
    if (what === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    if (what === "reload") wc.reload();
    if (what === "external" && /^https?:/i.test(wc.getURL())) shell.openExternal(wc.getURL());
  });
  handle("ft:bounds", (r: { x: number; y: number; width: number; height: number } | null) => {
    ftShown = !!r && r.width > 0 && r.height > 0;
    if (!ftView) return;
    const z = win?.webContents.getZoomFactor() ?? 1;
    if (ftShown) ftView.setBounds({ x: Math.round(r!.x * z), y: Math.round(r!.y * z), width: Math.round(r!.width * z), height: Math.round(r!.height * z) });
    ftView.setVisible(ftShown);
  });
  // calls from FreeToken pages (window.vrun) — only honoured from the FreeToken view
  ipcMain.handle("ftbridge:connect", async (e, token: string) => {
    if (!fromFreeToken(e)) return { ok: false, error: "Not allowed." };
    if (!/^ft_\S+$/.test(token.trim())) return { ok: false, error: "That isn't a FreeToken token." };
    try {
      settings.ftTokenEnc = encrypt(token);
      settings.ftUrl = `${ftOrigin()}/api/v1`;
      settings.provider = "freetoken";
      saveSettings();
      send("settings-changed", null);
      return { ok: true, value: true };
    } catch (err) { return { ok: false, error: (err as Error).message }; }
  });
  ipcMain.handle("ftbridge:focus", async (e) => {
    if (!fromFreeToken(e)) return { ok: false, error: "Not allowed." };
    send("ft-view-close", null);
    return { ok: true, value: true };
  });
  ipcMain.handle("ftbridge:open-project", async (e, id: string) => {
    if (!fromFreeToken(e)) return { ok: false, error: "Not allowed." };
    if (!/^[\w-]{1,64}$/.test(id)) return { ok: false, error: "Bad project id." };
    try { await openFreeTokenProject(id); send("ft-view-close", null); return { ok: true, value: true }; }
    catch (err) { return { ok: false, error: (err as Error).message }; }
  });
  handle("ai:approve", (sid: string, toolId: string, ok: boolean) => ai.approve(sid, toolId, ok));
  handle("ai:stop", (sid: string) => ai.stop(sid));
  // the project's snapshots (before / during / after each task) and putting one back
  handle("history:list", () => history.list(getRoot()));
  handle("history:restore", async (id: string) => {
    const r = await history.restore(getRoot(), String(id));
    const files = r.undo ? (await history.changedSince(getRoot()!, r.undo).catch(() => [])).map((f) => f.path) : [];
    return { ...r, files };
  });
  handle("team:snapshot", (sid: string) => team.snapshot(String(sid)));
  handle("team:stop", (sid: string, name?: string) => team.stopAgent(String(sid), name ? String(name) : undefined));
  handle("ai:reset", (sid: string) => { ai.resetSession(sid); ft.resetFreeTokenSession(sid); });
  // the open project's last chat: restored on start and after a window reload, saved as it changes
  handle("chat:restore", () => {
    const root = getRoot();
    const ui = root ? chats.loadUi(root) : null;
    if (!ui?.sid) return null;
    const mem = chats.loadAgent(ui.sid);
    // a task still marked running means V-Run closed mid-task (and it isn't running now): offer to resume it
    const interrupted = runningTasks.has(ui.sid) ? null : chats.loadRunning(ui.sid);
    if (mem) { ai.restoreSession(ui.sid, mem.claude, mem.skills); ft.restoreTranscript(ui.sid, mem.ft ?? []); }
    // a Team-mode chat gets its team back: the agents, their reports and memories, who owns which file
    const saved = chats.loadTeam<team.SavedTeam>(ui.sid);
    if (saved && team.importTeam(ui.sid, saved)) {
      for (const a of saved.agents) {
        const wsid = team.workerSid(ui.sid, a.name), wmem = chats.loadAgent(wsid);
        if (wmem) { ai.restoreSession(wsid, wmem.claude, wmem.skills); ft.restoreTranscript(wsid, wmem.ft ?? []); }
      }
    }
    // still working (the window reloaded, or the folder was reopened): the chat shows it as busy
    const running = runningTasks.has(ui.sid);
    return { ...ui, ...(interrupted ? { interrupted } : {}), ...(running ? { running: true } : {}) };
  });
  // the resume offer was dismissed: forget the interrupted task
  handle("chat:dismiss-interrupted", (sid: string) => chats.markRunning(String(sid), null));
  // the renderer asks for a notification (an approval is waiting while V-Run isn't in front)
  handle("app:notify", (title: string, body: string) => { if (!inFront()) notify(String(title), String(body)); });
  handle("chat:save", (chat: chats.UiChat) => { const root = getRoot(); if (root && chat?.sid) chats.saveUi(root, chat); });
  handle("ai:pending", (sid: string) => ai.pendingChanges(sid));
  handle("ai:rewind", async (sid: string, index: number) => {
    const r = await ai.rewind(sid, index);
    if (r?.provider === "ft") ft.truncateFreeToken(sid, r.hist);
    return r?.restored ?? [];
  });
  handle("ai:accept", (sid: string, rel: string) => ai.acceptChange(sid, rel));
  handle("ai:reject", (sid: string, rel: string) => ai.rejectChange(sid, rel));
  handle("ai:original", (sid: string, rel: string) => ai.originalOf(sid, rel));
  handle("ai:cmdk", (req: Parameters<typeof ai.cmdK>[0]) => (useFreeToken() ? ft.cmdKFreeToken(req) : ai.cmdK(req)));
  handle("ai:models", () => ft.listModels());
  handle("ai:complete", async (id: string, req: Parameters<typeof ai.complete>[0]) => {
    for (const [k, c] of completions) { c.abort(); completions.delete(k); } // only the latest request matters
    const ctl = new AbortController();
    completions.set(id, ctl);
    try { return await (useFreeToken() ? ft.completeFreeToken(req, ctl.signal) : ai.complete(req, ctl.signal)); }
    catch (e) { if (ctl.signal.aborted) return ""; throw e; }
    finally { completions.delete(id); }
  });

  handle("settings:get", () => ({
    provider: useFreeToken() ? "freetoken" : "anthropic",
    model: settings.model, hasKey: !!storedKey(), envKey: !!process.env.ANTHROPIC_API_KEY, canEncrypt: safeStorage.isEncryptionAvailable(),
    ftUrl: settings.ftUrl, ftModel: settings.ftModel, hasFtToken: !!ftToken(),
  }));
  handle("settings:set", (patch: { provider?: Settings["provider"]; model?: string; apiKey?: string | null; ftUrl?: string; ftModel?: string; ftToken?: string | null }) => {
    if (patch.provider) settings.provider = patch.provider;
    if (patch.model) settings.model = patch.model.trim();
    if (patch.apiKey === null) delete settings.apiKeyEnc; else if (patch.apiKey) settings.apiKeyEnc = encrypt(patch.apiKey);
    if (patch.ftUrl !== undefined) settings.ftUrl = patch.ftUrl.trim() || ft.FREETOKEN_DEFAULT_URL;
    if (patch.ftModel) settings.ftModel = patch.ftModel.trim();
    if (patch.ftToken === null) delete settings.ftTokenEnc;
    else if (patch.ftToken) {
      if (!/^ft_\S+$/.test(patch.ftToken.trim())) throw new Error("FreeToken tokens start with ft_ — copy it from FreeToken's API tokens page.");
      settings.ftTokenEnc = encrypt(patch.ftToken);
    }
    saveSettings();
    send("settings-changed", null);
    return true;
  });

  handle("term:run", (id: string, command: string) => termRun(id, command));
  handle("app:start", (command: string) => runner.startApp(command));
  handle("app:stop", () => runner.stopApp());
  handle("app:input", (text: string) => runner.appInput(text));
  handle("app:status", () => runner.appStatus());
  handle("preview:open", async (url: string) => {
    const err = await runner.previewHost()!.open(/^https?:\/\//i.test(url) ? url : `http://${url}`);
    if (err) throw new Error(err);
  });
  handle("preview:reload", () => preview?.webContents.reload());
  // phone / tablet preview: a real mobile viewport (width, user agent), scaled to fit the pane
  handle("preview:device", async (d: { kind: "desktop" | "phone" | "tablet"; scale?: number }) => {
    // desktop is how the preview starts: nothing to undo unless a device was emulated
    if (d.kind === "desktop" && !emulating) return;
    const wc = ensurePreview().webContents;
    const size = d.kind === "phone" ? { width: 390, height: 844 } : d.kind === "tablet" ? { width: 820, height: 1180 } : null;
    const ua = d.kind === "phone" ? MOBILE_UA : d.kind === "tablet" ? TABLET_UA : desktopUA;
    // Chrome's device mode: the page sees a phone-sized viewport (innerWidth 390), touch input and the
    // mobile flag, rendered scaled down to fit the pane
    const dbg = wc.debugger;
    try {
      if (!dbg.isAttached()) dbg.attach("1.3");
      if (size) {
        await dbg.sendCommand("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: 0, mobile: true, scale: Math.max(0.2, Math.min(1, d.scale ?? 1)) });
        await dbg.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      } else {
        await dbg.sendCommand("Emulation.clearDeviceMetricsOverride");
        await dbg.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: false });
      }
    } catch (e) { console.error("device emulation failed", e); }
    emulating = !!size;
    if (ua && wc.getUserAgent() !== ua) { wc.setUserAgent(ua); if (wc.getURL()) wc.reload(); }
  });
  // open the app on a phone: its LAN address (checked), a QR code; or a public HTTPS link (tunnel)
  handle("share:info", async () => {
    const st = runner.appStatus();
    const current = preview?.webContents.getURL() || st.url || "";
    if (!/^https?:/i.test(current)) return { url: null, lan: null, reachable: false, qr: null, advice: "Start your app first (or ask the agent to run it).", addresses: share.lanAddresses() };
    const lan = share.lanUrl(current);
    const ok = lan ? await share.reachable(lan) : false;
    return { url: current, lan, reachable: ok, qr: lan && ok ? await share.qrSvg(lan) : null, advice: ok ? null : lan ? share.bindAdvice(st.command) : "This computer isn't on a network.", addresses: share.lanAddresses() };
  });
  handle("share:tunnel-start", async () => {
    const current = preview?.webContents.getURL() || runner.appStatus().url || "";
    const port = Number(new URL(current).port) || (current.startsWith("https") ? 443 : 80);
    const s = await share.startTunnel(port);
    return { ...s, qr: s.status === "on" ? await share.qrSvg(s.url) : null };
  });
  handle("share:tunnel-stop", () => share.stopTunnel());
  // the panel shows a link that's already running when it's opened again, and follows changes live
  const withQr = async (s: share.TunnelState) => ({ ...s, qr: s.status === "on" ? await share.qrSvg(s.url) : null });
  handle("share:tunnel-state", () => withQr(share.tunnelState()));
  share.onTunnel((s) => { void withQr(s).then((x) => send("share-tunnel", x)).catch(() => {}); });
  // Publish: the website online on a free host
  handle("publish:plan", () => publisher.planPublish());
  handle("publish:start", async (o: { provider: publisher.Provider; name: string; build: string | null; dir: string }) => {
    const rec = await publisher.publish(o, (line) => send("publish-log", line));
    return { ...rec, qr: await share.qrSvg(rec.url) };
  });
  handle("publish:cancel", () => publisher.cancelPublish());
  // Android app: check the tools, prepare / build the APK, install it on a USB-connected phone
  // Close folder: stop everything working on it, then no project is open
  handle("folder:close", () => {
    leaveProject();
    watcher?.close(); watcher = null;
    clearTimeout(changeTimer); clearTimeout(indexTimer);
    clearRoot();
  });
  handle("android:check", () => android.checkAndroid());
  // the user agreed in the panel: install Android Studio / get Java 21 / open Android Studio to finish setup
  handle("android:setup", () => android.setupAndroid((line) => send("android-log", line)));
  handle("android:open-studio", () => { const s = android.findStudio(); if (s) android.openStudio(s); return !!s; });
  handle("android:download-page", () => shell.openExternal(android.STUDIO_URL));
  handle("android:build", (o: { name: string; appId?: string; build: boolean }) => android.buildAndroid(o, (line) => send("android-log", line)));
  handle("android:install", (apk: string) => android.installApk(String(apk), (line) => send("android-log", line)));
  handle("android:reveal", (p: string) => shell.showItemInFolder(String(p)));
  handle("android:cancel", () => android.cancelAndroid());
  // Benchmark: the same coding tasks for each chosen model (through FreeToken), graded by running them
  const benchFile = () => path.join(app.getPath("userData"), "benchmark.json");
  handle("bench:models", async () => {
    if (!useFreeToken()) throw new Error("Benchmarking compares FreeToken's models: switch the provider to FreeToken in Settings.");
    return (await ft.listModels()).filter((m) => !/^auto-/.test(m));
  });
  handle("bench:progress", () => bench.benchmarkProgress());
  handle("bench:last", () => { try { return JSON.parse(fs.readFileSync(benchFile(), "utf8")); } catch { return null; } });
  handle("bench:scores", () => ft.routerScores("agent").catch(() => null));
  handle("bench:start", async (models: string[]) => {
    if (bench.benchmarkRunning()) throw new Error("A benchmark is already running.");
    if (runningTasks.size) throw new Error("Wait for the agent to finish first — the benchmark needs the workspace to itself.");
    const results = await bench.runBenchmark(models.map(String).slice(0, 6), (req, emit) => ft.chatFreeToken(req, emit), (e) => send("bench-event", e), (m, ok, reason) => ft.reportModel(m, ok, reason));
    try { fs.writeFileSync(benchFile(), JSON.stringify({ at: Date.now(), results })); } catch { /* not worth failing over */ }
    return results;
  });
  handle("bench:cancel", () => bench.cancelBenchmark());
  handle("preview:external", () => { const u = preview?.webContents.getURL(); if (u && /^https?:/i.test(u)) shell.openExternal(u); });
  handle("preview:bounds", (r: { x: number; y: number; width: number; height: number } | null) => {
    // remembered even before the view exists: the first page opened while the Preview tab is already
    // showing creates the view later, and it must appear right away (it stayed blank until a resize)
    previewWanted = r && r.width > 0 && r.height > 0 ? r : null;
    applyPreviewBounds();
  });
  handle("term:kill", (id: string) => terms.get(id)?.kill());
}

app.whenReady().then(async () => {
  chats.setChatsDir(path.join(app.getPath("userData"), "chats"));
  history.setHistoryDir(path.join(app.getPath("userData"), "history"));
  // the default menu's hidden shortcuts (Ctrl+R / Ctrl+Shift+R / F5) reload the window mid-work;
  // without it those keys reach the editor and terminal instead
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  const initial = process.env.CURSOR_REMAKE_OPEN;
  win!.webContents.once("did-finish-load", async () => {
    if (initial) await openFolder(initial);
    if (pendingLink) { const u = pendingLink; pendingLink = null; handleDeepLink(u); }
  });
  // V-Run inside the FreeToken repo brings its server up when it's the model provider
  // and when V-Run has no AI set up at all, it connects itself to that server: zero-step first run
  const noAi = !ftToken() && !storedKey() && !process.env.ANTHROPIC_API_KEY;
  if (ftRoot && !isTest && (useFreeToken() || noAi))
    link.ensureServer(ftOrigin(), ftRoot)
      .then(async (how) => { if (how === "started") send("ft-server", "started"); if (await tryAutoConnect()) send("ft-server", "connected"); })
      .catch(() => {});
});
app.on("will-quit", () => link.stopServer());
app.on("before-quit", () => { quitting = true; share.stopTunnel(); });
app.on("window-all-closed", () => {
  watcher?.close(); watcher = null;
  clearTimeout(changeTimer); clearTimeout(indexTimer);
  for (const p of terms.values()) p.kill();
  runner.stopApp();
  app.quit();
});
