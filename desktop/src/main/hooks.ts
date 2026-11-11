// Hooks: your own commands run around the agent's tool calls, like Claude Code's. In ~/.v-run/hooks.json
// (yours) or the project's .v-run/hooks.json (asked once, like project MCP servers):
//   { "PreToolUse":  [{ "matcher": "run_terminal_command|write_file", "command": "node .v-run/guard.js" }],
//     "PostToolUse": [{ "matcher": "edit_file|write_file", "command": "npx prettier --write \"$VRUN_FILE\"" }],
//     "Stop":        [{ "command": "npm test --silent" }] }
// Each hook gets the event as JSON on stdin (and VRUN_TOOL / VRUN_FILE in its environment).
//  - PreToolUse: exit code 2 blocks the call; what the hook printed to stderr is the reason the agent sees.
//  - PostToolUse: what it prints is added to the tool's result (a formatter's or linter's report).
//  - Stop: before the agent finishes; exit code 2 sends it back to work with stderr as the reason.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isTrusted, trust } from "./mcp";
import { killTree, shellArgs, windowsShell } from "./runner";

export type Hook = { matcher?: string; command: string; timeout?: number };
export type HookConfig = { PreToolUse?: Hook[]; PostToolUse?: Hook[]; Stop?: Hook[] };
type Event = "PreToolUse" | "PostToolUse" | "Stop";

const home = () => process.env.VRUN_HOME || path.join(os.homedir(), ".v-run");
const read = (file: string): HookConfig => { try { const j = JSON.parse(fs.readFileSync(file, "utf8")); return j?.hooks ?? j ?? {}; } catch { return {}; } };
export const userHooksFile = () => path.join(home(), "hooks.json");
export const projectHooksFile = (root: string) => path.join(root, ".v-run", "hooks.json");

let loaded: { root: string; config: HookConfig } | null = null;
/** The hooks for this project: yours, plus the project's after `askTrust` says yes (once per version of the file). */
export async function loadHooks(root: string | null, askTrust: (file: string, hooks: HookConfig) => Promise<boolean>) {
  if (!root) return (loaded = null);
  if (loaded?.root === root) return loaded;
  const config: HookConfig = { ...read(userHooksFile()) };
  const pf = projectHooksFile(root);
  if (fs.existsSync(pf)) {
    const proj = read(pf);
    const any = (["PreToolUse", "PostToolUse", "Stop"] as Event[]).some((k) => proj[k]?.length);
    if (any && (isTrusted(pf) || (await askTrust(pf, proj)))) {
      trust(pf);
      for (const k of ["PreToolUse", "PostToolUse", "Stop"] as Event[]) config[k] = [...(config[k] ?? []), ...(proj[k] ?? [])];
    }
  }
  return (loaded = { root, config });
}
export const resetHooks = () => { loaded = null; };

const matches = (h: Hook, tool: string) => !h.matcher || h.matcher === "*" || new RegExp(`^(?:${h.matcher})$`).test(tool);

function runHook(h: Hook, payload: Record<string, unknown>, root: string): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    // PowerShell's -Command exits 0 or 1, not with the program's own code: pass that through (exit 2 = block)
    const p = spawn(win ? windowsShell() : "/bin/bash", shellArgs(win ? `${h.command}; if ($LASTEXITCODE) { exit $LASTEXITCODE }` : h.command), {
      cwd: root, windowsHide: true, detached: !win,
      env: { ...process.env, VRUN_EVENT: String(payload.event), VRUN_TOOL: String(payload.tool ?? ""), VRUN_FILE: String((payload.input as any)?.path ?? ""), VRUN_PROJECT: root },
    });
    let out = "", err = "";
    p.stdout?.setEncoding("utf8"); p.stderr?.setEncoding("utf8");
    p.stdout?.on("data", (d: string) => { out = (out + d).slice(-8000); });
    p.stderr?.on("data", (d: string) => { err = (err + d).slice(-8000); });
    const timer = setTimeout(() => { killTree(p); err += `\n(hook timed out after ${(h.timeout ?? 60)}s)`; }, (h.timeout ?? 60) * 1000);
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out, err: e.message }); });
    p.on("close", (code) => { clearTimeout(timer); resolve({ code, out: out.trim(), err: err.trim() }); });
    p.stdin?.end(JSON.stringify(payload));
  });
}

/** Before a tool runs: null to go ahead, or the reason a hook blocked it. */
export async function preToolUse(tool: string, input: unknown, root: string | null): Promise<string | null> {
  const hooks = (loaded?.root === root ? loaded?.config.PreToolUse : undefined)?.filter((h) => matches(h, tool)) ?? [];
  for (const h of hooks) {
    const r = await runHook(h, { event: "PreToolUse", tool, input, cwd: root }, root!);
    if (r.code === 2) return r.err || r.out || `blocked by the hook "${h.command}"`;
  }
  return null;
}

/** After a tool ran: what the hooks printed (added to the result the agent sees), or "". */
export async function postToolUse(tool: string, input: unknown, result: string, root: string | null): Promise<string> {
  const hooks = (loaded?.root === root ? loaded?.config.PostToolUse : undefined)?.filter((h) => matches(h, tool)) ?? [];
  const notes: string[] = [];
  for (const h of hooks) {
    const r = await runHook(h, { event: "PostToolUse", tool, input, result: result.slice(0, 20_000), cwd: root }, root!);
    const said = [r.out, r.code ? r.err : ""].filter(Boolean).join("\n");
    if (said) notes.push(`Hook "${h.command}"${r.code ? ` (exit ${r.code})` : ""}:\n${said.slice(0, 3000)}`);
  }
  return notes.length ? `\n\n${notes.join("\n\n")}` : "";
}

/** Before the agent finishes: the reason to keep working (a Stop hook exited 2), or null. */
export async function stopHook(root: string | null): Promise<string | null> {
  for (const h of (loaded?.root === root ? loaded?.config.Stop : undefined) ?? []) {
    const r = await runHook(h, { event: "Stop", cwd: root }, root!);
    if (r.code === 2) return `The hook "${h.command}" says the task isn't finished:\n${(r.err || r.out).slice(0, 3000)}`;
  }
  return null;
}
