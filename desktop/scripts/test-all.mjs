// Runs every V-Run test suite (test/*.test.ts) one after another, each with a time limit, so a suite that
// hangs is reported as timed out instead of stalling the whole run. Exit code 1 if any suite failed.
//   npm test                 all suites
//   npm test -- core safety  only these
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIMIT_MS = Number(process.env.VRUN_TEST_LIMIT_MS ?? 8 * 60_000);
const only = process.argv.slice(2);
const order = ["core", "safety"]; // quick ones first
const suites = readdirSync(path.join(root, "test")).filter((f) => f.endsWith(".test.ts")).map((f) => f.slice(0, -8))
  .filter((n) => !only.length || only.includes(n))
  .sort((a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) || a.localeCompare(b));

const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const results = [];
for (const name of suites) {
  const started = Date.now();
  const r = await new Promise((done) => {
    const p = spawn(process.execPath, [tsx, `test/${name}.test.ts`], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, FORCE_COLOR: "0" } });
    let out = "";
    p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    p.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
    const timer = setTimeout(() => {
      out += `\nTIMED OUT after ${LIMIT_MS / 1000}s`;
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(p.pid), "/t", "/f"], { stdio: "ignore" });
      else p.kill("SIGKILL");
      done({ code: "timeout", out });
    }, LIMIT_MS);
    p.on("close", (code) => { clearTimeout(timer); done({ code, out }); });
  });
  const pass = (r.out.match(/^PASS /gm) ?? []).length, fail = (r.out.match(/^FAIL /gm) ?? []).length;
  results.push({ name, ok: r.code === 0 && !fail, code: r.code, pass, fail, s: Math.round((Date.now() - started) / 1000) });
}

console.log("\n──────── V-Run tests ────────");
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name.padEnd(16)} ${String(r.pass).padStart(3)} passed  ${r.fail ? `${r.fail} failed  ` : ""}${r.code === "timeout" ? "TIMED OUT  " : ""}${r.s}s`);
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n${bad.length} of ${results.length} suites failed` : `\nall ${results.length} suites passed`);
process.exit(bad.length ? 1 : 0);
