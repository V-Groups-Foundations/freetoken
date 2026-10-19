import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AppStatus, type Entry, type FtViewState, type GrepHit, type IndexStatus, type PreviewState, type Settings } from "./api";
import { ChatPanel } from "./Chat";
import { Banner } from "./Logo";
import ftMark from "./brand/freetoken.png";
import { FreeTokenHub } from "./FreeTokenHub";
import { EditorArea, liveText, registerTabCompletions, type Review, type Selection, type Tab } from "./Editor";

export function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    api.getFolder().then((f) => { setRoot(f.root); setRecent(f.recent); });
    return api.onFolderOpened((r) => setRoot(r));
  }, []);
  const closeFolder = () => { api.getFolder().then((f) => setRecent(f.recent)); setRoot(null); };
  if (!root) return <Welcome recent={recent} onOpen={setRoot} />;
  return <Workbench key={root} root={root} onCloseFolder={closeFolder} />;
}

function Welcome({ recent, onOpen }: { recent: string[]; onOpen: (r: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const open = async (p?: string) => {
    try { const r = p ? await api.openFolder(p) : await api.pickFolder(); if (r) onOpen(r); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="welcome">
      <div className="welcome-card">
        <Banner />
        <p className="muted">An AI code editor powered by your free FreeToken models.</p>
        <button className="btn primary big" onClick={() => open()}>Open folder…</button>
        {error && <div className="error" role="alert">{error}</div>}
        {recent.length > 0 && <>
          <h3>Recent</h3>
          {recent.map((r) => <button key={r} className="linklike recent" onClick={() => open(r)}>{r}</button>)}
        </>}
      </div>
    </div>
  );
}

function Workbench({ root, onCloseFolder }: { root: string; onCloseFolder: () => void }) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [review, setReview] = useState<(Review & { sid: string }) | null>(null);
  const [side, setSide] = useState<"files" | "search">("files");
  const [quickOpen, setQuickOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // the FreeToken tab in place of the editor: "hub" (V-Run's own dashboard) or a web route (only for
  // signing in — the full website opens in the browser), or null when closed
  const [ftPane, setFtPane] = useState<string | null>(null);
  const openFt = useCallback((route = "hub") => {
    setFtPane(route);
    if (route !== "hub") api.ftOpen(route).catch(() => {}); // failures arrive as ft-view-error
  }, []);
  const [termOpen, setTermOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [aiPrompt, setAiPrompt] = useState<{ text: string; n: number } | null>(null);
  const askAI = useCallback((text: string) => setAiPrompt((p) => ({ text, n: (p?.n ?? 0) + 1 })), []);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  // when the app starts or a page opens (by the agent or the user), bring the panel up on it
  useEffect(() => {
    const a = api.onAppEvent((e) => { if (e.type === "start") { setTermOpen(true); setPanelTab("app"); } });
    const b = api.onPreviewOpen(() => { setTermOpen(true); setPanelTab("preview"); });
    return () => { a(); b(); };
  }, []);
  const [index, setIndex] = useState<IndexStatus>({ state: "indexing" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [treeVersion, setTreeVersion] = useState(0);
  const [pendingVersion, setPendingVersion] = useState(0);
  const [chatFocus, setChatFocus] = useState(0);
  const [tabEnabled, setTabEnabled] = useState(true);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [reveal, setReveal] = useState<{ path: string; line: number; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const tabOn = useRef(tabEnabled);
  tabOn.current = tabEnabled;

  useEffect(() => {
    const d = registerTabCompletions(() => tabOn.current);
    return () => d.dispose();
  }, []);
  useEffect(() => {
    const off = api.onIndexStatus(setIndex);
    api.indexStatus().then(setIndex).catch(() => {}); // indexing may have finished before this mounted
    return off;
  }, []);
  useEffect(() => { api.getSettings().then(setSettings); }, [settingsOpen]);
  useEffect(() => {
    const subs = [
      api.onFtViewOpen((route) => setFtPane(route)),
      api.onFtViewClose(() => setFtPane(null)),
      api.onSettingsChanged(() => api.getSettings().then((x) => {
        setSettings((prev) => { if (prev && !prev.hasFtToken && x.hasFtToken) setToast("V-Run is connected to FreeToken"); return x; });
        setFtPane((p) => (p === "/v-run" && x.hasFtToken ? "hub" : p)); // signed in: back to the hub
      })),
      api.onFtServer((st) => setToast(st === "connected" ? "V-Run connected itself to FreeToken — chat is ready" : "Started the FreeToken server")),
    ];
    return () => subs.forEach((u) => u());
  }, []);

  const openFile = useCallback(async (path: string, line?: number) => {
    setReview(null);
    if (!tabsRef.current.some((t) => t.path === path)) {
      try {
        const text = await api.read(path);
        setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, { path, text, saved: text }]));
      } catch (e) { setToast((e as Error).message); return; }
    }
    setActive(path);
    if (line) setReveal({ path, line, nonce: Date.now() });
  }, []);

  // reload open, unmodified tabs when files change on disk (agent edits, external tools)
  const reloadFromDisk = useCallback(async (paths: string[]) => {
    setTreeVersion((v) => v + 1);
    for (const p of paths) {
      const t = tabsRef.current.find((x) => x.path === p);
      if (!t || t.text !== t.saved) continue;
      try {
        const text = await api.read(p);
        setTabs((ts) => ts.map((x) => (x.path === p ? { ...x, text, saved: text } : x)));
      } catch {
        setTabs((ts) => ts.filter((x) => x.path !== p)); // deleted
      }
    }
  }, []);
  useEffect(() => api.onFsChanged((paths) => { reloadFromDisk(paths); setPendingVersion((v) => v + 1); }), [reloadFromDisk]);

  async function save(path: string) {
    const t = tabsRef.current.find((x) => x.path === path);
    if (!t) return;
    const text = liveText(path) ?? t.text;
    try { await api.write(path, text); setTabs((ts) => ts.map((x) => (x.path === path ? { ...x, text, saved: text } : x))); }
    catch (e) { setToast((e as Error).message); }
  }
  function close(path: string) {
    const t = tabsRef.current.find((x) => x.path === path);
    if (t && t.text !== t.saved && !window.confirm(`Discard unsaved changes to ${path}?`)) return;
    const idx = tabsRef.current.findIndex((x) => x.path === path);
    const rest = tabsRef.current.filter((x) => x.path !== path);
    setTabs(rest);
    if (active === path) setActive(rest[Math.min(idx, rest.length - 1)]?.path ?? null);
  }

  async function showReview(sid: string, path: string) {
    const original = await api.original(sid, path);
    let current = "";
    try { current = await api.read(path); } catch { current = ""; }
    setReview({ sid, path, original: original ?? "", current });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); pickFolder(); }
      else if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); setQuickOpen(true); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setSide("search"); }
      else if (mod && e.key === "`") { e.preventDefault(); setTermOpen((v) => !v); }
      else if (mod && e.key === ",") { e.preventDefault(); setSettingsOpen(true); }
      else if (mod && e.key.toLowerCase() === "l" && !(e.target as HTMLElement).closest(".monaco-editor")) { e.preventDefault(); setChatFocus((n) => n + 1); }
      else return;
      e.stopPropagation();
    };
    // capture phase so Monaco can't swallow app-level shortcuts
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  // Ctrl+S in the capture phase so it works whether focus is in Monaco, the tree or the chat
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const onSaveKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        if (activeRef.current) save(activeRef.current);
      }
    };
    window.addEventListener("keydown", onSaveKey, true);
    return () => window.removeEventListener("keydown", onSaveKey, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);

  // a successful pick fires "folder-opened", which remounts the workbench on the new root
  function pickFolder() { api.pickFolder().catch((e) => setToast((e as Error).message)); }

  return (
    <div className={`workbench${termOpen ? " with-term" : ""}`}>
      <nav className="activity" aria-label="Views">
        <button className={side === "files" ? "on" : ""} onClick={() => setSide("files")} title="Explorer" aria-label="Explorer">🗀</button>
        <button className={side === "search" ? "on" : ""} onClick={() => setSide("search")} title="Search (Ctrl+Shift+F)" aria-label="Search">⌕</button>
        <button onClick={pickFolder} title="Open folder (Ctrl+O)" aria-label="Open folder">📂</button>
        <button onClick={onCloseFolder} title="Close folder" aria-label="Close folder">⏏</button>
        <button className={ftPane !== null ? "on ft-act" : "ft-act"} onClick={() => (ftPane !== null ? setFtPane(null) : openFt("hub"))} title="FreeToken — your models, projects and usage" aria-label="FreeToken"><img src={ftMark} alt="" className="act-img" /></button>
        <span className="spacer" />
        <button onClick={() => { setTermOpen(true); setPanelTab("app"); }} title="Run app / Preview" aria-label="Run app">▶</button>
        <button onClick={() => setTermOpen((v) => !v)} title="Terminal (Ctrl+`)" aria-label="Toggle terminal">⌨</button>
        <button onClick={() => setSettingsOpen(true)} title="Settings (Ctrl+,)" aria-label="Settings">⚙</button>
      </nav>
      <aside className="sidebar">
        {side === "files"
          ? <Explorer root={root} version={treeVersion} active={active} onOpen={openFile} onError={setToast} />
          : <SearchPanel onOpen={openFile} />}
      </aside>
      <main className={`main${termOpen && panelExpanded ? " panel-expanded" : ""}${ftPane !== null ? " ft-mode" : ""}`}>
        {ftPane === "hub" && <FreeTokenHub onSignIn={() => openFt("/v-run")} onClose={() => setFtPane(null)} onToast={setToast} />}
        {ftPane !== null && ftPane !== "hub" && <FreeTokenPane covered={quickOpen || settingsOpen} onClose={() => setFtPane(null)} onHub={() => setFtPane("hub")} />}
        <EditorArea tabs={tabs} active={active} review={review} revealLine={reveal}
          onSelect={(p) => { setReview(null); setActive(p); }} onClose={close}
          onChange={(p, text) => setTabs((ts) => ts.map((t) => (t.path === p ? { ...t, text } : t)))}
          onSave={save}
          onAddToChat={(s) => { setSelection(s.text ? s : null); setChatFocus((n) => n + 1); }}
          onAcceptReview={async (p) => { await api.accept(review!.sid, p); setReview(null); setPendingVersion((v) => v + 1); }}
          onRejectReview={async (p) => { await api.reject(review!.sid, p); setReview(null); reloadFromDisk([p]); setPendingVersion((v) => v + 1); }}
          onCloseReview={() => setReview(null)} />
        {termOpen && <BottomPanel tab={panelTab} onTab={setPanelTab} covered={quickOpen || settingsOpen} onClose={() => { setTermOpen(false); setPanelExpanded(false); }}
          expanded={panelExpanded} onToggleExpand={() => setPanelExpanded((v) => !v)} height={panelHeight} onResize={setPanelHeight} askAI={askAI} />}
      </main>
      <ChatPanel activeFile={active} openFiles={tabs.map((t) => t.path)} pendingSelection={selection} clearSelection={() => setSelection(null)}
        onFilesChanged={reloadFromDisk} onReview={showReview} onOpenFile={openFile} inject={aiPrompt} pendingVersion={pendingVersion} focusSignal={chatFocus} />
      <footer className="status">
        <button className="linklike" onClick={pickFolder} title={`${root} — click to open another folder (Ctrl+O)`}>{root.split(/[\\/]/).pop()}</button>
        <span className="spacer" />
        <button className="linklike" onClick={() => api.reindex()} title="Re-index codebase">
          {index.state === "indexing" ? "Indexing…" : index.state === "error" ? `Index error: ${index.message}` : `Indexed ${index.files} files · ${index.chunks} chunks`}
        </button>
        <button className="linklike" onClick={() => setTabEnabled((v) => !v)} aria-pressed={tabEnabled}>Tab: {tabEnabled ? "on" : "off"}</button>
        <button className="linklike" onClick={() => setSettingsOpen(true)}>{settings ? (settings.provider === "freetoken" ? (settings.hasFtToken ? `FreeToken · ${settings.ftModel}` : "⚠ No FreeToken token") : settings.hasKey || settings.envKey ? settings.model : "⚠ No API key") : ""}</button>
      </footer>
      {quickOpen && <QuickOpen onClose={() => setQuickOpen(false)} onPick={(p) => { setQuickOpen(false); openFile(p); }} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onOpenFreeToken={(route) => { setSettingsOpen(false); openFt(route); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Explorer({ root, version, active, onOpen, onError }: { root: string; version: number; active: string | null; onOpen: (p: string) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set([""]));
  const [children, setChildren] = useState<Record<string, Entry[]>>({});
  const load = useCallback(async (dir: string) => {
    try { const list = await api.list(dir || "."); setChildren((c) => ({ ...c, [dir]: list })); } catch (e) { onError((e as Error).message); }
  }, [onError]);
  useEffect(() => { for (const d of open) load(d); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (d: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(d)) n.delete(d); else { n.add(d); load(d); }
    return n;
  });
  const [creating, setCreating] = useState<string | null>(null);
  async function newFile(name: string) {
    setCreating(null);
    if (!name.trim()) return;
    try { await api.write(name.trim(), ""); load(name.includes("/") ? name.slice(0, name.lastIndexOf("/")) : ""); onOpen(name.trim()); } catch (e) { onError((e as Error).message); }
  }
  const render = (dir: string, depth: number): JSX.Element[] => (children[dir] ?? []).flatMap((e) => [
    <button key={e.path} className={`tree-item${active === e.path ? " active" : ""}`} style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => (e.dir ? toggle(e.path) : onOpen(e.path))} aria-expanded={e.dir ? open.has(e.path) : undefined} aria-label={e.name}>
      <span className="twisty" aria-hidden>{e.dir ? (open.has(e.path) ? "▾" : "▸") : ""}</span>{e.name}
    </button>,
    ...(e.dir && open.has(e.path) ? render(e.path, depth + 1) : []),
  ]);
  return (
    <div className="explorer">
      <div className="side-head"><span title={root}>{root.split(/[\\/]/).pop()?.toUpperCase()}</span><span className="spacer" />
        <button className="btn ghost small" onClick={() => setCreating("")} title="New file" aria-label="New file">＋</button>
        <button className="btn ghost small" onClick={() => { for (const d of open) load(d); }} title="Refresh" aria-label="Refresh">⟳</button></div>
      {creating !== null && (
        <input className="field" autoFocus placeholder="path/to/new-file.ts" aria-label="New file path" value={creating} style={{ margin: "0 8px 6px", width: "auto" }}
          onChange={(e) => setCreating(e.target.value)} onBlur={() => setCreating(null)}
          onKeyDown={(e) => { if (e.key === "Enter") newFile(creating); if (e.key === "Escape") setCreating(null); }} />
      )}
      <div className="tree" role="tree">{render("", 0)}</div>
    </div>
  );
}

function SearchPanel({ onOpen }: { onOpen: (p: string, line?: number) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ hits: GrepHit[]; truncated: boolean } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function run() {
    if (!q.trim()) return;
    try { setErr(null); setRes(await api.grep(q, { fixed: true })); } catch (e) { setErr((e as Error).message); }
  }
  const byFile = new Map<string, GrepHit[]>();
  for (const h of res?.hits ?? []) byFile.set(h.path, [...(byFile.get(h.path) ?? []), h]);
  return (
    <div className="search-panel">
      <div className="side-head">SEARCH</div>
      <input className="field" placeholder="Search text (Enter)" value={q} autoFocus aria-label="Search text"
        onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} />
      {err && <div className="error">{err}</div>}
      {res && <div className="muted pad">{res.hits.length}{res.truncated ? "+" : ""} results in {byFile.size} files</div>}
      <div className="tree">
        {[...byFile].map(([f, hits]) => (
          <div key={f}>
            <div className="hit-file">{f}</div>
            {hits.map((h) => (
              <button key={h.line} className="hit" onClick={() => onOpen(f, h.line)}><span className="muted">{h.line}</span> {h.text.trim()}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickOpen({ onClose, onPick }: { onClose: () => void; onPick: (p: string) => void }) {
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [sel, setSel] = useState(0);
  const [resultsFor, setResultsFor] = useState<string | null>(null);
  useEffect(() => { let live = true; api.searchFiles(q).then((f) => { if (live) { setFiles(f); setSel(0); setResultsFor(q); } }); return () => { live = false; }; }, [q]);
  // Enter right after typing: wait for this query's results instead of picking stale ones
  async function pickCurrent() {
    if (resultsFor === q) { if (files[sel]) onPick(files[sel]); return; }
    const f = await api.searchFiles(q);
    if (f[0]) onPick(f[0]);
  }
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Go to file" onMouseDown={(e) => e.stopPropagation()}>
        <input autoFocus className="field" placeholder="Search files by name" value={q} aria-label="File name"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, files.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter") pickCurrent();
          }} />
        <div className="palette-list" role="listbox">
          {files.slice(0, 30).map((f, i) => (
            <button key={f} role="option" aria-selected={i === sel} className={i === sel ? "on" : ""} onClick={() => onPick(f)}>
              <b>{f.split("/").pop()}</b> <span className="muted">{f}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SettingsDialog({ onClose, onOpenFreeToken }: { onClose: () => void; onOpenFreeToken: (route: string) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [provider, setProvider] = useState<Settings["provider"]>("anthropic");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [ftUrl, setFtUrl] = useState("");
  const [ftToken, setFtToken] = useState("");
  const [ftModel, setFtModel] = useState("auto-smart");
  const [ftModels, setFtModels] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    api.getSettings().then((x) => { setS(x); setProvider(x.provider); setModel(x.model); setFtUrl(x.ftUrl); setFtModel(x.ftModel); });
  }, []);
  async function save() {
    try {
      await api.setSettings({ provider, model, ftUrl, ftModel, ...(key ? { apiKey: key } : {}), ...(ftToken ? { ftToken } : {}) });
      setMsg("Saved"); setKey(""); setFtToken(""); setS(await api.getSettings());
    } catch (e) { setMsg((e as Error).message); }
  }
  async function test() {
    try {
      await api.setSettings({ provider: "freetoken", ftUrl, ...(ftToken ? { ftToken } : {}) });
      setFtToken("");
      const ids = await api.models();
      setFtModels(ids);
      setS(await api.getSettings());
      setMsg(`Connected to FreeToken — ${ids.length} models available.`);
    } catch (e) { setFtModels(null); setMsg((e as Error).message); }
  }
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <div className="mode-switch provider-switch" role="radiogroup" aria-label="AI provider">
          {([["anthropic", "Claude (Anthropic)"], ["freetoken", "FreeToken"]] as const).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={provider === id} className={provider === id ? "on" : ""} onClick={() => setProvider(id)}>{label}</button>
          ))}
        </div>
        {provider === "anthropic" ? (
          <>
            <label>Anthropic API key
              <input className="field" type="password" placeholder={s?.hasKey ? "•••••••• (saved — enter a new one to replace)" : s?.envKey ? "Using ANTHROPIC_API_KEY from the environment" : "sk-ant-…"}
                value={key} onChange={(e) => setKey(e.target.value)} />
            </label>
            <label>Model
              <input className="field" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <p className="muted">Routes chat, Ctrl+K and Tab through your FreeToken server, which picks a free model for each request.</p>
            <div className="ft-card">
              <div>
                <b>{s?.hasFtToken ? "Connected to FreeToken" : "Sign in with FreeToken"}</b>
                <div className="muted">{s?.hasFtToken ? "Open FreeToken for your projects, models and usage — without leaving V-Run." : "Sign in once inside V-Run and it connects itself — no token to copy."}</div>
              </div>
              <div className="row">
                {!s?.hasFtToken && <button className="btn primary" onClick={() => onOpenFreeToken("/v-run")}>Sign in with FreeToken</button>}
                <button className="btn" onClick={() => onOpenFreeToken("hub")}>Open FreeToken</button>
                <button className="btn" onClick={() => api.ftWebsite("/")} title="The full FreeToken website, in your browser">Website ↗</button>
              </div>
            </div>
            <label>FreeToken API URL
              <input className="field" value={ftUrl} onChange={(e) => setFtUrl(e.target.value)} placeholder="http://localhost:3000/api/v1" />
            </label>
            <label>FreeToken API token
              <input className="field" type="password" aria-label="FreeToken API token" value={ftToken} onChange={(e) => setFtToken(e.target.value)}
                placeholder={s?.hasFtToken ? "•••••••• (saved — enter a new one to replace)" : "ft_…  (FreeToken → Settings → API tokens)"} />
            </label>
            <label>Model
              <select className="field" aria-label="FreeToken model" value={ftModel} onChange={(e) => setFtModel(e.target.value)}>
                {[...new Set(["auto-smart", "auto-fast", ftModel, ...(ftModels ?? [])])].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <div className="row"><button className="btn" onClick={test}>Test connection</button></div>
          </>
        )}
        <p className="muted">Keys and tokens are stored encrypted with your OS keychain (Electron safeStorage).</p>
        {msg && <div className="muted" role="status">{msg}</div>}
        <div className="row">
          {provider === "anthropic" && s?.hasKey && <button className="btn" onClick={async () => { await api.setSettings({ apiKey: null }); setS(await api.getSettings()); setMsg("Key removed"); }}>Remove key</button>}
          {provider === "freetoken" && s?.hasFtToken && <button className="btn" onClick={async () => { await api.setSettings({ ftToken: null }); setS(await api.getSettings()); setMsg("Token removed"); }}>Remove token</button>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

let termSeq = 0;
type PanelTab = "terminal" | "app" | "preview";

function BottomPanel(props: {
  tab: PanelTab; onTab: (t: PanelTab) => void; covered: boolean; onClose: () => void; askAI: (text: string) => void;
  expanded: boolean; onToggleExpand: () => void; height: number | null; onResize: (h: number) => void;
}) {
  const { tab, expanded } = props;
  const [dragging, setDragging] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  const tabs: [PanelTab, string][] = [["terminal", "Terminal"], ["app", "App"], ["preview", "Preview"]];
  // drag the top edge to resize; the native preview is hidden meanwhile so it can't swallow the pointer
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const main = self.current?.parentElement;
    if (!main || expanded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    const bottom = main.getBoundingClientRect().bottom, max = main.clientHeight - 80;
    const move = (ev: PointerEvent) => props.onResize(Math.max(120, Math.min(max, bottom - ev.clientY)));
    const up = () => { setDragging(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const height = expanded ? undefined : props.height ?? (tab === "preview" ? "min(55vh, 560px)" : 240);
  return (
    <div ref={self} className={`panel${expanded ? " expanded" : ""}`} style={{ height }}>
      {!expanded && <div className="panel-resize" role="separator" aria-orientation="horizontal" aria-label="Resize panel" onPointerDown={startDrag} onDoubleClick={props.onToggleExpand} />}
      <div className="panel-tabs" role="tablist" aria-label="Panel" onDoubleClick={(e) => e.target === e.currentTarget && props.onToggleExpand()}>
        {tabs.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => props.onTab(t)}>{label}</button>)}
        <span className="spacer" />
        <button aria-label={expanded ? "Restore panel" : "Expand panel"} title={expanded ? "Restore (show the editor again)" : "Expand to fill the editor area"} onClick={props.onToggleExpand}>{expanded ? "⤡" : "⤢"}</button>
        <button aria-label="Close panel" title="Close panel" onClick={props.onClose}>✕</button>
      </div>
      <div className="panel-body" hidden={tab !== "terminal"}><Terminal /></div>
      <div className="panel-body" hidden={tab !== "app"}><AppRunner askAI={props.askAI} /></div>
      <div className="panel-body" hidden={tab !== "preview"}><Preview visible={tab === "preview"} covered={props.covered || dragging} askAI={props.askAI} /></div>
    </div>
  );
}

/** The user's app: one long-running process (dev server, CLI, bot) the agent can also see and drive. */
const APP_ERROR = /(^|\n)\s*(Traceback \(most recent call last\)|[A-Z]\w*(Error|Exception)\b[:\s]|npm ERR!|error(\[\w+\])?:|panic:|fatal:|Uncaught )/;
function AppRunner({ askAI }: { askAI: (text: string) => void }) {
  const [st, setSt] = useState<AppStatus>({ running: false, command: "", output: "" });
  const [cmd, setCmd] = useState("");
  const [line, setLine] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const out = useRef<HTMLPreElement>(null);
  useEffect(() => {
    api.appStatus().then((s) => { setSt(s); setCmd(s.command); }).catch(() => {});
    return api.onAppEvent((e) => {
      if (e.type === "start") { setSt({ running: true, command: e.command, output: "" }); setCmd(e.command); setErr(null); }
      else if (e.type === "data") setSt((s) => ({ ...s, output: (s.output + e.data).slice(-200_000) }));
      else if (e.type === "url") setSt((s) => ({ ...s, url: e.url }));
      else setSt((s) => ({ ...s, running: false, exitCode: e.code }));
    });
  }, []);
  useEffect(() => { out.current?.scrollTo({ top: out.current.scrollHeight }); }, [st.output]);
  const wrap = (p: Promise<unknown>) => p.catch((e) => setErr((e as Error).message));
  const start = () => cmd.trim() && wrap(api.appStart(cmd.trim()));
  // a crash or an error in recent output gets a one-click "Fix with AI"
  const tail = st.output.slice(-6000);
  const problem = !st.running && st.exitCode != null && st.exitCode !== 0 ? `Exited with code ${st.exitCode}`
    : APP_ERROR.test(tail) ? "Printed an error" : null;
  return (
    <section className="terminal" aria-label="App">
      <div className="term-input">
        <span aria-hidden>▶</span>
        <input className="field" aria-label="App command" value={cmd} onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()} placeholder="e.g. npm run dev, python app.py" />
        {st.running
          ? <><button className="btn small" onClick={() => wrap(api.appStop())}>Stop</button><button className="btn small ghost" onClick={start}>Restart</button></>
          : <button className="btn small primary" onClick={start} disabled={!cmd.trim()}>Run</button>}
        {st.url && <button className="linklike" onClick={() => wrap(api.previewOpen(st.url!))} title="Open in the preview">{st.url}</button>}
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      {problem && (
        <div className="app-error" role="alert">
          <span>⚠ {problem}</span>
          <button className="btn small ai-btn" onClick={() => askAI(`My app (\`${st.command}\`) ${problem.toLowerCase()}. The end of its output:\n\`\`\`\n${st.output.trimEnd().split("\n").slice(-60).join("\n")}\n\`\`\`\nFind the cause and fix it, then run the app again with run_app to confirm it works.`)}>✦ Fix with AI</button>
        </div>
      )}
      <pre ref={out} aria-label="App output">{st.output || "Your app's output shows here. Ask the agent to run your app, or type its command above."}</pre>
      {st.running && (
        <div className="term-input">
          <span>&gt;</span>
          <input className="field" aria-label="App input" value={line} onChange={(e) => setLine(e.target.value)} placeholder="Type input for the app and press Enter"
            onKeyDown={(e) => { if (e.key === "Enter") { wrap(api.appInput(line)); setLine(""); } }} />
        </div>
      )}
    </section>
  );
}

/** Embedded browser: the main process lays a sandboxed WebContentsView over the .preview-host box. */
/** The FreeToken web app (a separate view the main process lays over this box), with a small toolbar. */
function FreeTokenPane({ covered, onClose, onHub }: { covered: boolean; onClose: () => void; onHub: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<FtViewState>({ url: "", title: "", loading: true, canGoBack: false });
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const a = api.onFtViewState((x) => { setSt(x); setErr(null); });
    const b = api.onFtViewError((m) => setErr(m));
    return () => { a(); b(); };
  }, []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      api.ftBounds(!covered && !err && r.width > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null).catch(() => {});
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    return () => { ro.disconnect(); window.removeEventListener("resize", report); api.ftBounds(null).catch(() => {}); };
  }, [covered, err]);
  let where = "";
  try { where = st.url ? new URL(st.url).pathname : ""; } catch { /* about:blank */ }
  return (
    <section className="ft-pane" aria-label="FreeToken">
      <div className="ft-bar">
        <button className="btn small ghost" onClick={onHub} title="Back to the FreeToken hub">← Hub</button>
        <span className="ft-brand"><img src={ftMark} alt="" />FreeToken · sign in</span>
        <button className="btn small ghost" onClick={() => api.ftNav("back")} disabled={!st.canGoBack} aria-label="Back" title="Back">←</button>
        <button className="btn small ghost" onClick={() => api.ftNav("reload")} aria-label="Reload FreeToken" title="Reload">↻</button>
        <button className="btn small ghost" onClick={() => api.ftNav("home")} title="Home">Home</button>
        <span className="ft-where muted" title={st.url}>{st.loading ? "Loading…" : st.title ? `${st.title} · ${where}` : where}</span>
        <span className="spacer" />
        <button className="btn small ghost" onClick={() => api.ftNav("external")} title="Open in your browser">↗</button>
        <button className="btn small ghost" onClick={onClose} aria-label="Close FreeToken" title="Back to the editor">✕</button>
      </div>
      <div ref={host} className="ft-host">
        {err ? (
          <div className="ft-msg" role="alert"><b>FreeToken isn't reachable</b><span className="muted">{err}</span>
            <button className="btn primary" onClick={() => { setErr(null); api.ftNav("home").catch((e) => setErr((e as Error).message)); }}>Try again</button></div>
        ) : !st.url && <div className="ft-msg muted">Starting FreeToken…</div>}
      </div>
    </section>
  );
}

function Preview({ visible, covered, askAI }: { visible: boolean; covered: boolean; askAI: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PreviewState>({ url: "", title: "", loading: false });
  const [addr, setAddr] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => api.onPreviewState((s) => { setState(s); setAddr(s.url); setErr(null); }), []);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      api.previewBounds(visible && !covered && r.width > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null).catch(() => {});
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    return () => { ro.disconnect(); window.removeEventListener("resize", report); api.previewBounds(null).catch(() => {}); };
  }, [visible, covered]);
  const go = () => addr.trim() && api.previewOpen(addr.trim()).catch((e) => setErr((e as Error).message));
  return (
    <section className="terminal preview" aria-label="Preview">
      <div className="term-input">
        <button className="btn small ghost" onClick={() => api.previewReload()} title="Reload" aria-label="Reload preview">↻</button>
        <input className="field" aria-label="Preview address" value={addr} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="http://localhost:3000" />
        <span className="muted">{state.loading ? "Loading…" : state.title}</span>
        <button className="btn small ghost" onClick={() => api.previewExternal()} disabled={!state.url} title="Open in your browser">↗</button>
        <button className="btn small ai-btn" disabled={!state.url} title="Have the agent look at this page, find errors or visual problems, and fix them"
          onClick={() => askAI(`Look at the page open in the preview (${state.url}) with inspect_preview. Check the console and what is on screen, find any errors or visual problems, and fix them in the code.`)}>✦ Ask AI</button>
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      <div ref={host} className="preview-host">
        {!state.url && <div className="muted preview-empty">Nothing to preview yet. Ask the agent to run your app, or type a URL above.</div>}
      </div>
    </section>
  );
}

function Terminal() {
  const [lines, setLines] = useState<string>("");
  const [cmd, setCmd] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const out = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const a = api.onTermData(({ data }) => setLines((l) => (l + data).slice(-200_000)));
    const b = api.onTermExit(({ id, code }) => { setLines((l) => `${l}\n[exit ${code}]\n`); setRunning((r) => (r === id ? null : r)); });
    return () => { a(); b(); };
  }, []);
  useEffect(() => { out.current?.scrollTo({ top: out.current.scrollHeight }); }, [lines]);
  async function run() {
    if (!cmd.trim() || running) return;
    const id = `t${++termSeq}`;
    setLines((l) => `${l}> ${cmd}\n`);
    setRunning(id); setCmd("");
    try { await api.termRun(id, cmd); } catch (e) { setLines((l) => `${l}${(e as Error).message}\n`); setRunning(null); }
  }
  return (
    <section className="terminal" aria-label="Terminal">
      <pre ref={out}>{lines || "Run a command in the project folder.\n"}</pre>
      <div className="term-input">
        <span>&gt;</span>
        <input className="field" aria-label="Terminal command" value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder={running ? "Running…" : "e.g. npm test"} />
        {running && <button className="btn small" onClick={() => api.termKill(running)}>Stop</button>}
        <button className="btn small ghost" onClick={() => setLines("")}>Clear</button>
      </div>
    </section>
  );
}
