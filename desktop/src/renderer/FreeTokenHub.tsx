// V-Run's FreeToken tab: a native dashboard of what matters while coding — your projects (open one
// here with its whole conversation), today's usage, providers and models. The full FreeToken website
// opens in the browser; the embedded web view is only used to sign in.
import { useCallback, useEffect, useState } from "react";
import { api, type FtHub } from "./api";
import ftMark from "./brand/freetoken.png";

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e5 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
function ago(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function FreeTokenHub({ onSignIn, onClose, onToast }: { onSignIn: () => void; onClose: () => void; onToast: (m: string) => void }) {
  const [hub, setHub] = useState<FtHub | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setHub(await api.ftHub()); } catch (e) { onToast((e as Error).message); }
    setLoading(false);
  }, [onToast]);
  useEffect(() => { load(); return api.onSettingsChanged(() => load()); }, [load]);

  async function start() {
    setStarting(true);
    try { await api.ftStartServer(); await load(); } catch (e) { onToast((e as Error).message); }
    setStarting(false);
  }
  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    try { await api.ftCreateProject(name.trim()); setName(""); onClose(); }
    catch (e) { onToast((e as Error).message); }
    setCreating(false);
  }
  async function open(id: string) {
    setOpening(id);
    try { await api.ftOpenProject(id); onClose(); } catch (e) { onToast((e as Error).message); }
    setOpening(null);
  }
  async function useModel(m: string) {
    try { await api.ftUseModel(m); onToast(`V-Run now uses ${m}`); load(); } catch (e) { onToast((e as Error).message); }
  }

  const state = hub?.state;
  const host = hub ? hub.origin.replace(/^https?:\/\//, "") : "";
  const projects = (hub?.projects ?? []).filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  const busiest = Math.max(1, ...(hub?.usage?.providers ?? []).map((p) => p.requests));

  return (
    <section className="ft-hub" aria-label="FreeToken">
      <header className="hub-hero">
        <div className="hub-hero-glow" aria-hidden />
        <img src={ftMark} alt="" className="hub-mark" />
        <div className="hub-title">
          <h1>FreeToken</h1>
          <div className="hub-sub">Your free AI models, projects and usage — right inside V-Run</div>
        </div>
        <span className="spacer" />
        <span className={`hub-pill ${state ?? "loading"}`} title={hub?.error}>
          <span className="dot" />
          {loading && !hub ? "Checking…" : state === "connected" ? `Connected · ${host}` : state === "offline" ? `Offline · ${host}` : state === "bad-token" ? "Sign-in expired" : "Not connected"}
        </span>
        <button className="hub-btn ghost" onClick={load} title="Refresh" aria-label="Refresh FreeToken">↻</button>
        <button className="hub-btn" onClick={() => api.ftWebsite("/")} title="Open the full FreeToken website in your browser">Open website ↗</button>
        <button className="hub-btn ghost" onClick={onClose} aria-label="Close FreeToken" title="Back to the editor">✕</button>
      </header>

      {loading && !hub ? (
        <div className="hub-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="hub-card skeleton" />)}</div>
      ) : state === "offline" ? (
        <div className="hub-empty">
          <img src={ftMark} alt="" />
          <h2>FreeToken isn't running</h2>
          <p>V-Run talks to your FreeToken server at <code>{host}</code>.{hub?.canStart ? " It lives right next to V-Run — start it with one click." : " Start it, then refresh."}</p>
          {hub?.canStart && <button className="hub-btn primary" onClick={start} disabled={starting}>{starting ? "Starting FreeToken…" : "Start FreeToken"}</button>}
        </div>
      ) : state !== "connected" ? (
        <div className="hub-empty">
          <img src={ftMark} alt="" />
          <h2>{state === "bad-token" ? "Sign in again" : "Connect V-Run to FreeToken"}</h2>
          <p>Use your free AI models in V-Run, and continue your FreeToken projects here with their whole conversation. One click — no token to copy.</p>
          <button className="hub-btn primary" onClick={onSignIn}>Sign in with FreeToken</button>
        </div>
      ) : (
        <div className="hub-body">
          <div className="hub-stats">
            {[
              ["Requests today", fmt(hub!.usage?.requests ?? 0), "across all providers"],
              ["Tokens today", fmt(hub!.usage?.tokens ?? 0), "prompt + completion"],
              ["Known requests left", fmt(hub!.usage?.remaining ?? 0), "from providers that report limits"],
            ].map(([label, value, hint], i) => (
              <div key={label} className="hub-stat" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="hub-stat-label">{label}</div>
                <div className="hub-stat-value">{value}</div>
                <div className="hub-stat-hint">{hint}</div>
              </div>
            ))}
          </div>

          <div className="hub-grid">
            <div className="hub-card hub-projects" style={{ animationDelay: "120ms" }}>
              <div className="hub-card-head"><h3>Projects</h3><span className="hub-count">{hub!.projects.length}</span><span className="spacer" />
                {hub!.projects.length > 5 && <input className="hub-input small" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter projects" />}</div>
              <form className="hub-new" onSubmit={(e) => { e.preventDefault(); create(); }}>
                <input className="hub-input" placeholder="New project name…" value={name} onChange={(e) => setName(e.target.value)} aria-label="New project name" />
                <button className="hub-btn primary" disabled={!name.trim() || creating}>{creating ? "Creating…" : "Create & open"}</button>
              </form>
              <div className="hub-list">
                {projects.length === 0 && <div className="hub-muted">{hub!.projects.length ? "No match." : "No projects yet — create one above, or start one in FreeToken's chat."}</div>}
                {projects.map((p) => (
                  <div key={p.id} className="hub-row">
                    <span className="hub-row-icon" aria-hidden>{p.name.slice(0, 1).toUpperCase()}</span>
                    <div className="hub-row-main"><div className="hub-row-name">{p.name}</div><div className="hub-muted">{ago(p.updatedAt)}</div></div>
                    <button className="hub-btn ghost small" onClick={() => api.ftWebsite(`/projects/${p.id}`)} title="Open this project's chat on the website">Chat ↗</button>
                    <button className="hub-btn primary small" onClick={() => open(p.id)} disabled={opening === p.id} aria-label={`Open ${p.name} in V-Run`}>
                      {opening === p.id ? "Opening…" : "▶ Open in V-Run"}</button>
                  </div>
                ))}
              </div>
            </div>

            <div className="hub-side">
              <div className="hub-card" style={{ animationDelay: "180ms" }}>
                <div className="hub-card-head"><h3>Providers</h3><span className="hub-count">{hub!.usage?.providers.length ?? 0}</span>
                  <span className="spacer" /><button className="hub-link" onClick={() => api.ftWebsite("/dashboard")}>Usage ↗</button></div>
                {(hub!.usage?.providers ?? []).length === 0 && <div className="hub-muted">No providers connected yet. <button className="hub-link" onClick={() => api.ftWebsite("/connect")}>Connect some ↗</button></div>}
                {(hub!.usage?.providers ?? []).map((p) => {
                  const pct = p.limit ? Math.min(100, (100 * (p.used ?? 0)) / p.limit) : (100 * p.requests) / busiest;
                  return (
                    <div key={p.id} className="hub-prov">
                      <div className="hub-prov-top"><span className={`dot s-${p.status}`} /><b>{p.name}</b><span className="spacer" />
                        <span className="hub-muted">{p.limit ? `${p.used ?? 0} / ${p.limit}` : `${p.requests} req`}</span></div>
                      <div className="hub-bar"><span style={{ width: `${Math.max(2, pct)}%` }} /></div>
                    </div>
                  );
                })}
              </div>

              <div className="hub-card" style={{ animationDelay: "240ms" }}>
                <div className="hub-card-head"><h3>Models</h3><span className="hub-count">{hub!.models.length}</span></div>
                <div className="hub-muted">Click one to make it V-Run's model.</div>
                <div className="hub-chips">
                  {[...new Set(["auto-smart", "auto-fast", ...hub!.models])].slice(0, 40).map((m) => (
                    <button key={m} className={`hub-chip${hub!.provider === "freetoken" && hub!.model === m ? " on" : ""}`} onClick={() => useModel(m)} title={m}>{m}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
