// The first screen: connect an AI (sign in with FreeToken in the browser, or a Claude API key), then open
// a folder, pick a recent one, or start a new project from a starter. A folder dropped here opens too.
import { useEffect, useState } from "react";
import { api, type Settings, type Starter } from "./api";
import { Banner } from "./Logo";

export function Welcome({ recent, onOpen }: { recent: string[]; onOpen: (r: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [home, setHome] = useState("");
  const [name, setName] = useState("");
  const [starter, setStarter] = useState("website");
  const [busy, setBusy] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    const load = () => api.getSettings().then(setSettings).catch(() => {});
    load();
    api.starters().then(setStarters).catch(() => {});
    api.projectsHome().then(setHome).catch(() => {});
    const offs = [api.onSettingsChanged(load), api.onSignedIn(() => { setWaiting(false); load(); })];
    return () => offs.forEach((off) => off());
  }, []);
  const hasAi = !!settings && (settings.hasFtToken || settings.hasKey || settings.envKey);

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };
  const open = (p?: string) => run("open", async () => { const r = p ? await api.openFolder(p) : await api.pickFolder(); if (r) onOpen(r); });
  const create = () => run("create", async () => { const made = await api.createProject(name || "My project", starter); onOpen(made.dir); });
  const signIn = () => run("signin", async () => { await api.signInFreeToken(); setWaiting(true); });
  const saveKey = () => run("key", async () => { await api.setSettings({ provider: "anthropic", apiKey: key.trim() }); setKey(""); setKeyOpen(false); setSettings(await api.getSettings()); });

  return (
    <div className={`welcome${drag ? " dropping" : ""}`}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; const p = f && api.pathForFile(f); if (p) open(p); }}>
      <div className="welcome-card">
        <Banner />
        <p className="muted">An AI code editor that builds, runs and checks your app — with free FreeToken models or your own Claude key.</p>

        {settings && !hasAi && (
          <section className="onboard-step" aria-label="Connect an AI">
            <h3>1 · Connect an AI</h3>
            <button className="btn primary big" disabled={busy === "signin"} onClick={signIn}>Sign in with FreeToken (free)</button>
            <p className="muted small">{waiting ? "Finish in your browser — V-Run connects as soon as you click Connect V-Run there." : "Opens your browser. Create an account or sign in, then click Connect V-Run."}</p>
            {!keyOpen
              ? <button className="linklike" onClick={() => setKeyOpen(true)}>…or use your own Claude API key</button>
              : <div className="onboard-key">
                <input className="field" type="password" autoFocus placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) saveKey(); }} />
                <button className="btn" disabled={!key.trim() || busy === "key"} onClick={saveKey}>Save</button>
              </div>}
          </section>
        )}
        {settings && hasAi && <p className="onboard-ok">✓ {settings.provider === "freetoken" ? "Connected to FreeToken" : "Using your Claude API key"}</p>}

        <section className="onboard-step" aria-label="Open a project">
          {settings && !hasAi && <h3>2 · Open a project</h3>}
          <button className={`btn ${hasAi ? "primary " : ""}big`} onClick={() => open()}>Open folder…</button>
          <p className="muted small">or drop a folder here</p>
          <details className="onboard-new">
            <summary>New project</summary>
            <input className="field" placeholder="Project name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} />
            <div className="starters" role="radiogroup" aria-label="Starter">
              {starters.map((s) => (
                <button key={s.id} role="radio" aria-checked={starter === s.id} className={`starter${starter === s.id ? " on" : ""}`} onClick={() => setStarter(s.id)}>
                  <b>{s.title}</b><span>{s.about}</span>
                </button>
              ))}
            </div>
            <button className="btn primary" disabled={busy === "create"} onClick={create}>Create{home ? ` in ${home.split(/[\\/]/).slice(-2).join("/")}` : ""}</button>
          </details>
        </section>

        {error && <div className="error" role="alert">{error}</div>}
        {recent.length > 0 && <>
          <h3>Recent</h3>
          {recent.map((r) => <button key={r} className="linklike recent" onClick={() => open(r)}>{r}</button>)}
        </>}
      </div>
    </div>
  );
}
