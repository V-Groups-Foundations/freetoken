// The terminal panel's commands. Each command runs as its own process (so Stop kills exactly it and its
// children), but the terminal keeps state between them like a shell does: the folder you `cd` into and
// the environment variables you set carry over to the next command. While a command runs, what you type
// goes to its input, so programs that ask questions (npm init, a Python input(), a y/n prompt) work.
// (Full-screen programs — vim, top — need a real pseudo-terminal, which this isn't.)
import { spawn, type ChildProcess } from "node:child_process";
import { getRoot } from "./workspace";
import { killTree, shellArgs, textOutput, windowsShell } from "./runner";

const MARK = "\u001eVRUN-END";
const win = process.platform === "win32";
/** Strip colours and cursor codes: the panel shows plain text. */
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

type Term = { root: string; cwd: string; env: NodeJS.ProcessEnv; proc: ChildProcess | null };
const terms = new Map<string, Term>();

function term(id: string): Term {
  let t = terms.get(id);
  const root = getRoot();
  if (!root) throw new Error("Open a folder first");
  // a terminal from another project starts over in this one
  if (!t || t.root !== root) {
    t = { root, cwd: root, env: { ...process.env }, proc: null };
    terms.set(id, t);
  }
  return t;
}

/** The command, wrapped so it reports where it ended up and the environment it left. */
function wrap(command: string) {
  if (win) {
    const q = `'${command.replace(/'/g, "''")}'`;
    return `$global:LASTEXITCODE = 0; $__c = ${q}; try { Invoke-Expression $__c } catch { Write-Error $_ }; $__ok = $?; `
      + `$__code = $(if ($LASTEXITCODE) { $LASTEXITCODE } elseif ($__ok) { 0 } else { 1 }); `
      + `$__env = @{}; foreach ($__e in Get-ChildItem env:) { $__env[$__e.Name] = $__e.Value }; `
      + `[Console]::Out.WriteLine("${MARK} " + $__code + " " + ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{ cwd = $PWD.ProviderPath; env = $__env } | ConvertTo-Json -Compress)))))`;
  }
  const q = `'${command.replace(/'/g, "'\\''")}'`;
  return `eval ${q}; __code=$?; printf '%s %s %s\\n' '${MARK}' "$__code" "$( { printf '{"cwd":'; printf '%s' "$PWD" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))' 2>/dev/null || printf '"%s"' "$PWD"; printf ',"env":'; node -e 'process.stdout.write(JSON.stringify(process.env))' 2>/dev/null || printf '{}'; printf '}'; } | base64 | tr -d '\\n')"`;
}

export type TermEvents = { data: (text: string) => void; exit: (code: number | null, cwd: string) => void };

/** Run one command in terminal `id` (its folder and environment carry over from the last one). */
export function run(id: string, command: string, on: TermEvents) {
  const t = term(id);
  if (t.proc) throw new Error("A command is still running — wait for it, type its input, or Stop it.");
  const p = spawn(win ? windowsShell() : "/bin/bash", shellArgs(wrap(command), true), { cwd: t.cwd, env: t.env, windowsHide: true, detached: !win });
  t.proc = p;
  let tail = "", code: number | null = null;
  textOutput(p, (chunk) => {
    // hold back a partial last line in case it's the start of the end marker
    const text = (tail + chunk).replace(ANSI, "");
    const lines = text.split("\n");
    tail = lines.pop() ?? "";
    const shown: string[] = [];
    for (const l of lines) {
      const at = l.indexOf(MARK);
      if (at < 0) { shown.push(l); continue; }
      if (at > 0) shown.push(l.slice(0, at));
      const [, c, b64] = l.slice(at).trim().split(" ");
      code = Number(c);
      try {
        const st = JSON.parse(Buffer.from(b64 ?? "", "base64").toString("utf8")) as { cwd?: string; env?: Record<string, string> };
        if (st.cwd) t.cwd = st.cwd;
        if (st.env && Object.keys(st.env).length) t.env = { ...st.env };
      } catch { /* the command ended oddly: keep the last state */ }
    }
    if (shown.length) on.data(`${shown.join("\n")}\n`);
    // a prompt with no newline yet ("Continue? (y/n) "): show it now, unless it could be the marker
    if (tail && !MARK.startsWith(tail.slice(0, MARK.length)) && !tail.includes(MARK[0])) { on.data(tail); tail = ""; }
  });
  p.on("error", (e) => on.data(`\n${e.message}\n`));
  p.on("close", (c) => {
    if (tail && !tail.includes(MARK)) on.data(tail);
    t.proc = null;
    on.exit(code ?? c, t.cwd);
  });
}

/** Type into the running command (a line of input), or false when nothing is running. */
export function input(id: string, text: string) {
  const p = terms.get(id)?.proc;
  if (!p?.stdin || p.stdin.destroyed) return false;
  p.stdin.write(`${text}\n`);
  return true;
}

/**
 * End the running command's input (Ctrl+D): a program that reads until its input ends — or one that
 * finished asking but still holds the input open — can then finish.
 */
export function endInput(id: string) {
  const p = terms.get(id)?.proc;
  if (!p?.stdin || p.stdin.destroyed) return false;
  p.stdin.end();
  return true;
}

/** Stop the running command and everything it started. */
export function stop(id: string) { const p = terms.get(id)?.proc; if (p) killTree(p); }
export const cwdOf = (id: string) => terms.get(id)?.cwd ?? getRoot() ?? "";
/** Quitting V-Run: every running command goes with it. */
export function stopAll() { for (const t of terms.values()) if (t.proc) killTree(t.proc, true); terms.clear(); }
