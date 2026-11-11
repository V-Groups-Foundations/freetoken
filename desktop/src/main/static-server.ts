// A built-in file server for plain websites. "npx serve ." (or http-server, live-server, python -m
// http.server) first downloads a package or needs Python, and an agent waited on that for every run; the
// same job is a few lines of Node, started at once with the Node inside V-Run (no install, no network).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The server itself, run as its own process: `<node> <this script> <folder> [port]`. */
const SCRIPT = String.raw`
const http = require("http"), fs = require("fs"), path = require("path");
const root = path.resolve(process.argv[2] || "."), port = Number(process.argv[3]) || 0;
const TYPES = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".xml": "application/xml", ".wasm": "application/wasm", ".map": "application/json", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".pdf": "application/pdf" };
const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400); return res.end("Bad request"); }
  let file = path.join(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  try { if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html"); } catch {}
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("404 Not Found: " + rel); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : data);
    console.log(req.method + " " + rel);
  });
});
server.on("error", (e) => { console.error(e.code === "EADDRINUSE" ? "Port " + port + " is already in use (EADDRINUSE)" : e.message); process.exit(1); });
server.listen(port, "127.0.0.1", () => console.log("Serving " + root + " at http://localhost:" + server.address().port));
`;

let scriptFile: string | null = null;
function script() {
  if (scriptFile && fs.existsSync(scriptFile)) return scriptFile;
  scriptFile = path.join(os.tmpdir(), "vrun-static-server.js");
  fs.writeFileSync(scriptFile, SCRIPT);
  return scriptFile;
}

const quote = (p: string) => process.platform === "win32" ? `'${p.replace(/'/g, "''")}'` : `'${p.replace(/'/g, "'\\''")}'`;

/**
 * The built-in server's command for a static-file-server command, or null when it isn't one (or uses
 * options the built-in server doesn't have — then the original runs). Recognised: npx serve, npx
 * http-server, npx live-server, python -m http.server, each with an optional folder and port.
 */
export function staticServerCommand(cmd: string): string | null {
  const m = /^\s*(?:npx\s+(?:--yes\s+|-y\s+)?(serve|http-server|live-server)(?:@[\w.^~-]+)?|(?:python3?|py)\s+-m\s+http\.server)((?:\s+\S+)*)\s*$/i.exec(cmd);
  if (!m) return null;
  const python = !m[1];
  const args = (m[2] ?? "").trim().split(/\s+/).filter(Boolean);
  let dir = ".", port = 0;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (/^(-p|-l|--port|--listen)$/.test(a) && /^\d+$/.test(args[i + 1] ?? "")) { port = Number(args[++i]); continue; }
    const eq = /^--(?:port|listen)=(\d+)$/.exec(a);
    if (eq) { port = Number(eq[1]); continue; }
    if (python && /^\d+$/.test(a)) { port = Number(a); continue; }
    if (python && a === "--directory" && args[i + 1]) { dir = args[++i]; continue; }
    if (/^(-s|--single|-c-1|--no-browser|-o|--silent|-q)$/.test(a)) continue; // harmless here
    if (a.startsWith("-")) return null; // an option we don't know: run the real thing
    dir = a.replace(/^["']|["']$/g, "");
  }
  const node = process.execPath;
  const run = `${quote(node)} ${quote(script())} ${quote(dir)}${port ? ` ${port}` : ""}`;
  // inside Electron, its own binary is Node when ELECTRON_RUN_AS_NODE is set
  return process.platform === "win32" ? `$env:ELECTRON_RUN_AS_NODE='1'; & ${run}` : `ELECTRON_RUN_AS_NODE=1 ${run}`;
}
