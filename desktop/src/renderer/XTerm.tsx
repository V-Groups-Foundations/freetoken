// The terminal panel: xterm.js on a real shell (main/pty.ts). Resizes with the panel, keeps its shell while
// the panel is hidden, starts a new one after `exit`. Ctrl+Shift+C / Ctrl+Shift+V copy and paste (plain
// Ctrl+C goes to the program, as in any terminal); right-click pastes.
import { useEffect, useRef, useState } from "react";
import { Terminal as XTermCore } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api } from "./api";

export const PTY_ID = "pty-main";

export function XTerm({ visible }: { visible: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<XTermCore | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [exited, setExited] = useState<number | null>(null);

  const start = async () => {
    const t = term.current;
    if (!t) return;
    setExited(null);
    await api.ptyOpen(PTY_ID, t.cols, t.rows).catch((e: Error) => t.writeln(`\r\n${e.message}`));
  };

  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const t = new XTermCore({
      fontFamily: css.getPropertyValue("--mono").trim() || "Consolas, 'Cascadia Mono', Menlo, monospace",
      fontSize: 13, cursorBlink: true, scrollback: 5000, allowProposedApi: false,
      theme: { background: css.getPropertyValue("--bg2").trim() || "#1e1e1e", foreground: css.getPropertyValue("--fg").trim() || "#d4d4d4" },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(box.current!);
    term.current = t; fit.current = f;
    try { f.fit(); } catch { /* not laid out yet */ }
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && e.shiftKey && k === "c") { const sel = t.getSelection(); if (sel) navigator.clipboard.writeText(sel).catch(() => {}); return false; }
      if (e.ctrlKey && e.shiftKey && k === "v") { navigator.clipboard.readText().then((x) => api.ptyWrite(PTY_ID, x)).catch(() => {}); return false; }
      return true;
    });
    const typed = t.onData((d) => { api.ptyWrite(PTY_ID, d).catch(() => {}); });
    const resized = t.onResize(({ cols, rows }) => { api.ptyResize(PTY_ID, cols, rows).catch(() => {}); });
    const offData = api.onPtyData(({ id, data }) => { if (id === PTY_ID) t.write(data); });
    const offExit = api.onPtyExit(({ id, code }) => { if (id === PTY_ID) { t.writeln(`\r\n\x1b[2m[shell exited${code ? ` with code ${code}` : ""} — press Enter for a new one]\x1b[0m`); setExited(code); } });
    const paste = (e: MouseEvent) => { e.preventDefault(); navigator.clipboard.readText().then((x) => api.ptyWrite(PTY_ID, x)).catch(() => {}); };
    box.current!.addEventListener("contextmenu", paste);
    const ro = new ResizeObserver(() => { try { f.fit(); } catch { /* hidden */ } });
    ro.observe(box.current!);
    start();
    return () => { typed.dispose(); resized.dispose(); offData(); offExit(); ro.disconnect(); t.dispose(); term.current = null; };
  }, []);

  // after `exit`, Enter starts a new shell
  useEffect(() => {
    if (exited === null || !term.current) return;
    const sub = term.current.onKey(({ domEvent }) => { if (domEvent.key === "Enter") start(); });
    return () => sub.dispose();
  }, [exited]);

  useEffect(() => { if (visible) { try { fit.current?.fit(); } catch { /* */ } term.current?.focus(); } }, [visible]);

  return <section className="xterm-box" aria-label="Terminal" ref={box} />;
}
