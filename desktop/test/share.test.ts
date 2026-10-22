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

  await check("a tunnel starts, reports its link, and stops; one that exits early reports why", async () => {
    const states: string[] = [];
    share.onTunnel((s) => states.push(s.status));
    const on = await share.startTunnel(5173, { command: `node -e "console.log('your url is: https://test-link.loca.lt'); setInterval(() => {}, 1000)"` });
    const running = share.tunnelState();
    share.stopTunnel();
    const failed = await share.startTunnel(5173, { command: `node -e "console.error('cannot connect'); process.exit(3)"` });
    return (on.status === "on" && on.url === "https://test-link.loca.lt" && running.status === "on" && share.tunnelState().status === "error"
      && failed.status === "error" && /exited \(code [1-9]\d*\).*cannot connect/.test(failed.message) && states.join() === "starting,on,off,starting,error")
      || JSON.stringify({ on, failed, states });
  });

  console.log(failures ? `\n${failures} failed` : "\nall share checks passed");
  process.exit(failures ? 1 : 0);
})();
