import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, WebContentsView } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as ai from "./ai";
import * as ft from "./ai-freetoken";
import * as index from "./indexer";
import * as link from "./freetoken-link";
import * as memory from "./memory";
import * as runner from "./runner";
import { fuzzyFiles, grep } from "./search";
import { deletePath, getRoot, isIgnored, listDir, readText, reloadIgnore, resolveInRoot, setRoot, writeText } from "./workspace";

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
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
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
ft.configureFreeToken({ url: ftBase, token: ftToken, model: () => settings.ftModel || "auto-smart" });
const useFreeToken = () => (process.env.CURSOR_REMAKE_PROVIDER ?? settings.provider) === "freetoken";
const errorText = (e: unknown) => (useFreeToken() ? ft.describeFreeTokenError(e) : ai.describeError(e));

// ---------------------------------------------------------------- window
let win: BrowserWindow | null = null;
// late events (a debounced file-watch flush, a stream finishing) can arrive after the window has closed
const send = (channel: string, payload: unknown) => {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
};

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 800, minHeight: 500,
    backgroundColor: "#1e1e1e", title: "V-Run", icon: path.join(__dirname, "../../assets", process.platform === "win32" ? "icon.ico" : "icon.png"),
    webPreferences: { preload: path.join(__dirname, "../preload/preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.on("closed", () => { win = null; });
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

async function openFolder(dir: string) {
  runner.stopApp();
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
  const shellBin = process.platform === "win32" ? "powershell.exe" : "/bin/bash";
  const args = process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-lc", command];
  const p = spawn(shellBin, args, { cwd: root, env: process.env });
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
let previewConsole: string[] = [];
let previewShown = false;

function ensurePreview() {
  if (preview) return preview;
  const v = new WebContentsView({ webPreferences: { partition: "persist:preview", sandbox: true, contextIsolation: true, nodeIntegration: false } });
  v.setVisible(false);
  win!.contentView.addChildView(v);
  const wc = v.webContents;
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) wc.loadURL(url).catch(() => {}); return { action: "deny" }; });
  wc.on("console-message", (e: any, legacyLevel?: number, legacyMessage?: string) => {
    const level = typeof e?.level === "string" ? e.level : ["verbose", "info", "warning", "error"][legacyLevel ?? 1];
    previewConsole.push(`[${level}] ${String(e?.message ?? legacyMessage).slice(0, 500)}`);
    if (previewConsole.length > 200) previewConsole.shift();
  });
  const state = () => send("preview-state", { url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading() });
  for (const ev of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) wc.on(ev as "did-stop-loading", state);
  wc.on("did-fail-load", (_e, code, desc, url, isMain) => { if (isMain && code !== -3) previewConsole.push(`[error] Failed to load ${url}: ${desc}`); });
  wc.on("render-process-gone", (_e, d) => previewConsole.push(`[error] The page crashed (${d.reason})`));
  preview = v;
  return v;
}

runner.setPreviewHost({
  async open(url) {
    const v = ensurePreview();
    previewConsole = [];
    send("preview-open", url);
    try { await v.webContents.loadURL(url); } catch (e) { return (e as Error).message; }
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

async function openFreeTokenProject(id: string) {
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
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
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
    if (useFreeToken()) ft.chatFreeToken(req, emit); else ai.chat(req, emit);
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
  handle("ai:reset", (sid: string) => { ai.resetSession(sid); ft.resetFreeTokenSession(sid); });
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
  handle("preview:external", () => { const u = preview?.webContents.getURL(); if (u && /^https?:/i.test(u)) shell.openExternal(u); });
  handle("preview:bounds", (r: { x: number; y: number; width: number; height: number } | null) => {
    previewShown = !!r && r.width > 0 && r.height > 0;
    if (!preview) return;
    // the renderer measures in CSS px; the view is placed in window DIPs, which differ when the UI is zoomed (Ctrl+= / Ctrl+-)
    const z = win?.webContents.getZoomFactor() ?? 1;
    if (previewShown) preview.setBounds({ x: Math.round(r!.x * z), y: Math.round(r!.y * z), width: Math.round(r!.width * z), height: Math.round(r!.height * z) });
    preview.setVisible(previewShown);
  });
  handle("term:kill", (id: string) => terms.get(id)?.kill());
}

app.whenReady().then(async () => {
  registerIpc();
  createWindow();
  const initial = process.env.CURSOR_REMAKE_OPEN;
  win!.webContents.once("did-finish-load", async () => {
    if (initial) await openFolder(initial);
    if (pendingLink) { const u = pendingLink; pendingLink = null; handleDeepLink(u); }
  });
  // V-Run inside the FreeToken repo brings its server up when it's the model provider
  if (useFreeToken() && ftRoot && !isTest)
    link.ensureServer(ftOrigin(), ftRoot).then((how) => how === "started" && send("ft-server", "started")).catch(() => {});
});
app.on("will-quit", () => link.stopServer());
app.on("window-all-closed", () => {
  watcher?.close(); watcher = null;
  clearTimeout(changeTimer); clearTimeout(indexTimer);
  for (const p of terms.values()) p.kill();
  runner.stopApp();
  app.quit();
});
