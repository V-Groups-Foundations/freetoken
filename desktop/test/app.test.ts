// The installable app's own parts: the real terminal, new projects from starters, "Sign in with FreeToken"
// links, and crash reports with nothing personal in them. No Electron, no model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}
const until = async (f: () => boolean, ms = 20_000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 50)); return f(); };

(async () => {
  const ws = await import("../src/main/workspace");
  const pty = await import("../src/main/pty");
  const starters = await import("../src/main/starters");
  const link = await import("../src/main/freetoken-link");
  const crash = await import("../src/main/crash");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-app-"));
  ws.setRoot(dir);

  await check("the terminal is a real shell: runs in the project folder, shows a prompt without a newline, takes typed input, resizes, ends", async () => {
    if (!pty.available()) return `node-pty didn't load: ${pty.whyUnavailable()}`;
    let out = "", exited: number | null = null;
    pty.open("t1", 100, 30, (d) => { out += d; }, (c) => { exited = c; });
    const ask = `node -e "process.stdout.write('Name? '); process.stdin.once('data', (d) => { console.log('Hi ' + String(d).trim()); process.exit(0); })"`;
    await new Promise((r) => setTimeout(r, 1500)); // the shell's own start-up
    pty.write("t1", process.platform === "win32" ? "(Get-Location).Path\r" : "pwd\r");
    const inFolder = await until(() => out.includes(path.basename(dir)));
    pty.write("t1", `${ask}\r`);
    const prompted = await until(() => /Name\? /.test(out));
    pty.write("t1", "Aiko\r");
    const answered = await until(() => out.includes("Hi Aiko"));
    pty.resize("t1", 120, 40);
    pty.write("t1", "exit\r");
    const ended = await until(() => exited !== null, 10_000);
    return (inFolder && prompted && answered && ended) || JSON.stringify({ inFolder, prompted, answered, ended, tail: out.slice(-400) });
  });

  await check("a new project gets its own folder with the starter's files; a taken name gets a number; bad names are cleaned", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-projects-"));
    const a = starters.createProject("My shop!", "website", home);
    const b = starters.createProject("My shop!", "website", home);
    const empty = starters.createProject("con", "empty", home);
    let bad = "";
    try { starters.createProject("x", "nope", home); } catch (e) { bad = (e as Error).message; }
    return (path.basename(a.dir) === "My shop!" && path.basename(b.dir) === "My shop! 2" && fs.existsSync(path.join(a.dir, "index.html"))
      && fs.readdirSync(empty.dir).length === 0 && path.basename(empty.dir) === "con-project" && /Unknown starter/.test(bad)
      && starters.folderName('a<b>:c/"d') === "abcd") || JSON.stringify({ a: a.dir, b: b.dir, empty: empty.dir, bad });
  });

  await check("vrun://connect: an ft_ token with a state is a sign-in; anything malformed is ignored", () => {
    const ok = link.parseDeepLink("vrun://connect?token=ft_abcdefghijklmnop1234&state=0123456789abcdefABCDEF");
    return (ok?.kind === "connect" && ok.token === "ft_abcdefghijklmnop1234"
      && link.parseDeepLink("vrun://connect?token=sk-ant-xxxxxxxxxxxxxxxxxxxx&state=0123456789abcdefABCDEF") === null
      && link.parseDeepLink("vrun://connect?token=ft_abcdefghijklmnop1234") === null
      && link.parseDeepLink("vrun://connect?token=ft_abc&state=short") === null
      && link.parseDeepLink("vrun://project/abc")?.kind === "project") || JSON.stringify(ok);
  });

  await check("crash reports: nothing personal survives scrubbing; each message goes once; nothing is sent when turned off", async () => {
    const s = crash.scrub("Error in C:\\Users\\aiko.sato\\Desktop\\shop\\server.js for aiko@example.jp key=ft_abcdefghijklmnopqrstu https://api.x.dev/v1?token=zzz 10.0.0.12 aiko.sato", "C:\\Users\\aiko.sato", "aiko.sato");
    const leaks = ["aiko", "example.jp", "ft_abc", "token=zzz", "10.0.0.12"].filter((x) => s.includes(x));
    const sent: string[] = [];
    let on = true;
    crash.installCrashReporting({ on: () => {} } as any, { version: "0.2.0", logDir: fs.mkdtempSync(path.join(os.tmpdir(), "vrun-crash-")), enabled: () => on, post: async (_u, b) => { sent.push(b); } });
    crash.report("main-error", new Error("boom in C:\\Users\\aiko.sato\\x.js"));
    crash.report("main-error", new Error("boom in C:\\Users\\aiko.sato\\x.js"));
    on = false;
    crash.report("main-error", new Error("another"));
    const body = JSON.parse(sent[0] ?? "{}");
    process.removeAllListeners("uncaughtException"); process.removeAllListeners("unhandledRejection");
    return (leaks.length === 0 && sent.length === 1 && body.kind === "main-error" && !JSON.stringify(body).includes("aiko") && body.version === "0.2.0")
      || JSON.stringify({ s, leaks, sent: sent.length, body });
  });

  pty.killAll();
  console.log(failures ? `\n${failures} failed` : "\nall app checks passed");
  process.exit(failures ? 1 : 0);
})();
