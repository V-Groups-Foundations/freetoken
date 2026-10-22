// Opening the app on a phone: LAN address + reachability, QR codes, and the HTTPS tunnel (run here
// through a stand-in command that prints a link like the real tunnels do).
import http from "node:http";
import * as share from "../src/main/share";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}
const serve = (host: string) => new Promise<http.Server>((r) => { const s = http.createServer((_q, res) => res.end("hi")); s.listen(0, host, () => r(s)); });
const node = (js: string) => [process.execPath, "-e", js]; // a stand-in tunnel program
const portOf = (s: http.Server) => (s.address() as { port: number }).port;

(async () => {
  await check("a localhost address becomes this computer's LAN address; real addresses stay as they are", async () => {
    const u = share.lanUrl("http://localhost:5173/app?x=1", "192.168.1.20");
    return (u === "http://192.168.1.20:5173/app?x=1" && share.lanUrl("http://127.0.0.1:3000/", "10.0.0.5") === "http://10.0.0.5:3000/"
      && share.lanUrl("https://example.com/", "10.0.0.5") === "https://example.com/" && share.lanUrl("http://localhost:1/", "") === null) || String(u);
  });

  await check("reachability: a server on all interfaces is reachable from the LAN address, one on 127.0.0.1 isn't", async () => {
    const ip = share.lanAddresses()[0];
    if (!ip) return true; // no network here: nothing to test
    const all = await serve("0.0.0.0"), local = await serve("127.0.0.1");
    try {
      const a = await share.reachable(`http://${ip}:${portOf(all)}/`), b = await share.reachable(`http://${ip}:${portOf(local)}/`, 1500);
      return (a && !b) || JSON.stringify({ ip, a, b });
    } finally { all.close(); local.close(); }
  });

  await check("QR codes render as SVG; advice names the right flag per dev server", async () => {
    const svg = await share.qrSvg("http://192.168.1.20:5173/");
    return (svg.startsWith("<svg") && svg.includes("path") && share.bindAdvice("npm run dev").includes("--host")
      && share.bindAdvice("python -m http.server 8000").includes("--bind 0.0.0.0") && share.bindAdvice("npx next dev").includes("0.0.0.0")) || svg.slice(0, 80);
  });

  await check("tunnel links are read from cloudflared and localtunnel output", async () => {
    const cf = share.tunnelUrlIn("2026 INF |  https://brave-otter-12.trycloudflare.com  |");
    const lt = share.tunnelUrlIn("your url is: https://quiet-fox-77.loca.lt\n");
    return (cf === "https://brave-otter-12.trycloudflare.com" && lt === "https://quiet-fox-77.loca.lt" && share.tunnelUrlIn("starting…") === null) || JSON.stringify({ cf, lt });
  });

  await check("the tunnel targets the loopback address the server answers on (0.0.0.0 → 127.0.0.1, ::1 only → [::1])", async () => {
    // cloudflared --url http://localhost:N tried ::1 for a server bound to 0.0.0.0: every request was a 502
    const v4 = await serve("0.0.0.0");
    const v6 = await serve("::1").catch(() => null); // no IPv6 here: only the first half applies
    try {
      const a = await share.loopbackUrl(portOf(v4)), b = v6 ? await share.loopbackUrl(portOf(v6)) : `http://[::1]:x`;
      return (a === `http://127.0.0.1:${portOf(v4)}` && (!v6 || b === `http://[::1]:${portOf(v6)}`)) || JSON.stringify({ a, b });
    } finally { v4.close(); v6?.close(); }
  });

  await check("a tunnel starts, reports its link, and stops; one that exits early reports why", async () => {
    const states: string[] = [];
    share.onTunnel((s) => states.push(s.status));
    const on = await share.startTunnel(5173, { argv: node(`console.log('your url is: https://test-link.loca.lt'); setInterval(() => {}, 1000)`) });
    const running = share.tunnelState();
    share.stopTunnel();
    const failed = await share.startTunnel(5173, { argv: node(`console.error('cannot connect'); process.exit(3)`) });
    return (on.status === "on" && on.url === "https://test-link.loca.lt" && running.status === "on" && share.tunnelState().status === "error"
      && failed.status === "error" && /exited \(code [1-9]\d*\).*cannot connect/.test(failed.message) && states.join() === "starting,on,off,starting,error")
      || JSON.stringify({ on, failed, states });
  });

  await check("a tunnel stopped while starting settles at once and never reports over the next one", async () => {
    // prints its link only after 3 s: still "starting" when it's stopped
    const slow = share.startTunnel(5173, { argv: node(`setTimeout(() => console.log('your url is: https://old-link.loca.lt'), 3000); setInterval(() => {}, 1000)`) });
    await new Promise((r) => setTimeout(r, 300));
    share.stopTunnel();
    const t0 = Date.now();
    const first = await slow;
    const settledMs = Date.now() - t0;
    const next = await share.startTunnel(5173, { argv: node(`console.log('your url is: https://new-link.loca.lt'); setInterval(() => {}, 1000)`) });
    await new Promise((r) => setTimeout(r, 3500)); // past the old process's link time
    const after = share.tunnelState();
    share.stopTunnel();
    return (first.status === "off" && settledMs < 10_000 && next.status === "on" && after.status === "on" && after.url === "https://new-link.loca.lt")
      || JSON.stringify({ first, settledMs, next, after });
  });

  await check("stopping a tunnel ends its process before returning (a link must not outlive V-Run when it quits)", async () => {
    const mark = `vrun-tunnel-${process.pid}-${Date.now()}`;
    await share.startTunnel(5173, { argv: node(`console.log('your url is: https://${mark}.loca.lt'); setInterval(() => {}, 1000)`) });
    share.stopTunnel(); // what before-quit does, with nothing after it
    const { execFileSync } = await import("node:child_process");
    const left = process.platform === "win32"
      ? execFileSync("powershell", ["-NoProfile", "-Command", `@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${mark}*' -and $_.Name -eq 'node.exe' }).Count`], { encoding: "utf8" }).trim()
      : execFileSync("sh", ["-c", `pgrep -fc '${mark}' || true`], { encoding: "utf8" }).trim();
    return left === "0" || `still running: ${left}`;
  });

  console.log(failures ? `\n${failures} failed` : "\nall share checks passed");
  process.exit(failures ? 1 : 0);
})();
