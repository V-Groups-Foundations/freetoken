// Open the app on a real phone: the same page at this computer's address on the local network (with a
// QR code to scan), checked for reachability first; and, because phones only allow location, camera and
// motion sensors on HTTPS pages, an optional public HTTPS link through a tunnel (Cloudflare's
// cloudflared when installed, else localtunnel through npx). While a tunnel runs, anyone with its link
// can open the app — the UI says so, and it stops when asked, when the app stops, or when V-Run quits.
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import QRCode from "qrcode";
import { killTree, windowsShell } from "./runner";

/** This computer's IPv4 addresses on local networks, the most likely one first (Wi-Fi/Ethernet LANs). */
export function lanAddresses(): string[] {
  const out: { ip: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
      const virtual = /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|br-|veth|utun|tailscale|zerotier/i.test(name);
      const rank = (virtual ? 10 : 0) + (a.address.startsWith("192.168.") ? 0 : a.address.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3);
      out.push({ ip: a.address, rank });
    }
  }
  return out.sort((a, b) => a.rank - b.rank).map((x) => x.ip);
}

/** The app's address as another device on the network sees it (localhost → this computer's LAN IP). */
export function lanUrl(url: string, ip = lanAddresses()[0]): string | null {
  try {
    const u = new URL(url);
    if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])$/i.test(u.hostname)) return url; // already a real address
    if (!ip) return null;
    u.hostname = ip;
    return u.toString();
  } catch { return null; }
}

/** Does anything answer at this address (a server listening only on localhost doesn't, from the LAN IP)? */
export function reachable(url: string, ms = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: ms }, (res) => { res.resume(); resolve(true); });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}

/** A QR code (SVG markup) for a link. */
export const qrSvg = (text: string) => QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });

/** Advice for a dev server that only listens on localhost, by what it is. */
export function bindAdvice(command: string) {
  const c = command.toLowerCase();
  if (/\bvite\b|npm run dev|pnpm dev|yarn dev/.test(c)) return "Start it with --host (e.g. npm run dev -- --host) so other devices can reach it.";
  if (/next (dev|start)/.test(c)) return "Start it with -H 0.0.0.0 (e.g. npx next dev -H 0.0.0.0).";
  if (/http\.server/.test(c)) return "Start it with --bind 0.0.0.0 (python -m http.server 8000 --bind 0.0.0.0).";
  if (/flask|uvicorn|streamlit|runserver/.test(c)) return "Start it on 0.0.0.0 (e.g. --host 0.0.0.0) so other devices can reach it.";
  return "The server listens only on this computer. Start it on all interfaces (0.0.0.0) — or use an HTTPS link instead, which works anyway.";
}

// ---------------------------------------------------------------- HTTPS tunnel

export type TunnelState = { status: "off" } | { status: "starting"; via: string } | { status: "on"; url: string; via: string; port: number } | { status: "error"; message: string };
let tunnel: ChildProcess | null = null;
let state: TunnelState = { status: "off" };
let listener: (s: TunnelState) => void = () => {};
export const onTunnel = (fn: (s: TunnelState) => void) => { listener = fn; };
export const tunnelState = () => state;
const set = (s: TunnelState) => { state = s; listener(s); };

/** cloudflared on PATH or in its usual install folders. */
export function findCloudflared(): string | null {
  const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter),
    ...(process.platform === "win32" ? ["C:\\Program Files (x86)\\cloudflared", "C:\\Program Files\\cloudflared"] : ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"])];
  for (const d of dirs) { const p = path.join(d, exe); try { if (d && fs.statSync(p).isFile()) return p; } catch { /* not here */ } }
  return null;
}

/** The public URL a tunnel prints (cloudflared quick tunnels / localtunnel). */
export function tunnelUrlIn(text: string): string | null {
  return /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(text)?.[0] ?? /your url is:\s*(https:\/\/\S+)/i.exec(text)?.[1] ?? null;
}

/**
 * Start a public HTTPS link to http://localhost:port. Resolves once the link is known (or fails after
 * 45 s). `command` overrides what's run (tests).
 */
export function startTunnel(port: number, opts: { command?: string } = {}): Promise<TunnelState> {
  stopTunnel();
  const cf = findCloudflared();
  const via = opts.command ? "custom" : cf ? "cloudflared" : "localtunnel";
  const cmd = opts.command ?? (cf ? `"${cf}" tunnel --no-autoupdate --url http://localhost:${port}` : `npx --yes localtunnel@2.0.2 --port ${port}`);
  set({ status: "starting", via });
  const win = process.platform === "win32";
  const p = spawn(win ? windowsShell() : "/bin/bash", win ? ["-NoProfile", "-NonInteractive", "-Command", win && cmd.startsWith('"') ? `& ${cmd}` : cmd] : ["-lc", cmd], { windowsHide: true, detached: !win });
  tunnel = p;
  return new Promise((resolve) => {
    let seen = "";
    const timer = setTimeout(() => finish({ status: "error", message: `No link after 45 seconds.${seen ? ` Last output: ${seen.trim().split("\n").slice(-2).join(" ").slice(0, 200)}` : ""}` }), 45_000);
    const finish = (s: TunnelState) => {
      clearTimeout(timer);
      if (s.status === "error") { if (tunnel === p) { killTree(p); tunnel = null; } }
      set(s);
      resolve(s);
    };
    const onData = (d: Buffer) => {
      seen = (seen + d.toString()).slice(-8000);
      const url = tunnelUrlIn(seen);
      if (url && state.status === "starting") finish({ status: "on", url, via, port });
    };
    p.stdout?.on("data", onData);
    p.stderr?.on("data", onData);
    p.on("error", (e) => finish({ status: "error", message: e.message }));
    p.on("close", (code) => {
      if (tunnel !== p) return;
      tunnel = null;
      if (state.status === "starting") finish({ status: "error", message: `The tunnel exited (code ${code}). ${seen.trim().split("\n").slice(-2).join(" ").slice(0, 200)}` });
      else if (state.status === "on") set({ status: "off" });
    });
  });
}

export function stopTunnel() {
  const p = tunnel;
  tunnel = null;
  if (p) killTree(p);
  if (state.status !== "off") set({ status: "off" });
}
