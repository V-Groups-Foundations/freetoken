// Sum up eval-chat logs, one row per run, to compare runs before and after a change:
//   npx tsx test/eval-summary.ts <log>... [--json]
// time per turn, how often the working model changed, and the slips the agent had to recover from.
import fs from "node:fs";
import path from "node:path";

export type RunSummary = {
  run: string; turns: number; seconds: number[]; total: number; finished: boolean;
  models: number; switches: number; failedTools: number; invalidCalls: number; brokenWrites: number;
  failedCheckRuns: number; secondOpinion: string; circles: number; waits: number; errors: number;
};

export function summarize(name: string, log: string): RunSummary {
  const lines = log.split(/\r?\n/);
  const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;
  const turns = count(/^=== turn \d+/);
  const seconds = [...log.matchAll(/done \((\w+)\) in (\d+)s/g)].map((m) => Number(m[2]));
  // the same model through another provider (nvidia/x, then openrouter/x:free) keeps the thread: not a switch
  const bare = (m: string) => m.split("/").slice(-1)[0].replace(/:free$/, "");
  const models = lines.map((l) => /\] model (\S+)/.exec(l)?.[1]).filter((m): m is string => !!m).map(bare);
  const perTurn = log.split(/^=== turn \d+.*$/m).slice(1).map((t) => [...t.matchAll(/\] model (\S+)/g)].map((m) => bare(m[1])).filter((m, i, a) => i === 0 || m !== a[i - 1]).length);
  const opinions = lines.filter((l) => /→ .*Second opinion/.test(l)).map((l) => /Second opinion(?: \([^)]*\))?: (.*)$/.exec(l)?.[1] ?? "?");
  return {
    run: name, turns, seconds, total: seconds.reduce((a, b) => a + b, 0), finished: seconds.length === turns,
    models: new Set(models).size,
    switches: perTurn.reduce((a, n) => a + Math.max(0, n - 1), 0),
    failedTools: count(/→ FAILED /), invalidCalls: count(/→ FAILED Invalid tool call/), brokenWrites: count(/doesn't parse yet/),
    failedCheckRuns: count(/→ (FAILED )?\d+ of \d+ (saved )?checks? fail/), secondOpinion: opinions.join("; ") || "-",
    circles: count(/Going in circles/i), waits: count(/\] waiting \d+s/), errors: count(/\] ERROR /),
  };
}

if (require.main === module) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const rows = files.map((f) => summarize(path.basename(f, ".log"), fs.readFileSync(f, "utf8")));
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else {
    const head = ["run", "turns", "seconds", "total", "models", "switches", "failed", "invalid", "broken", "check fails", "circles", "waits", "2nd opinion"];
    const body = rows.map((r) => [r.run, `${r.turns}${r.finished ? "" : "!"}`, r.seconds.join("+"), `${r.total}s`, r.models, r.switches, r.failedTools, r.invalidCalls, r.brokenWrites, r.failedCheckRuns, r.circles, r.waits, r.secondOpinion].map(String));
    const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => Math.min(60, b[i].length))));
    for (const r of [head, ...body]) console.log(r.map((c, i) => c.slice(0, 60).padEnd(w[i])).join("  "));
  }
}
