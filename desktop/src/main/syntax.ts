// Syntax checks on what the agent just wrote. Free models slip (a stray "</ card>", a missing brace, a
// duplicated block) and found out only minutes later from a blank preview, if at all; a parser finds it
// the moment the file is written, for free, with the line to fix.
import type * as TS from "typescript";

let ts: typeof TS | null | undefined;
function loadTs(): typeof TS | null {
  // loaded on first use (it's big), from V-Run's own node_modules; without it JS/TS go unchecked
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (ts === undefined) { try { ts = require("typescript") as typeof TS; } catch { ts = null; } }
  return ts;
}

export type SyntaxError_ = { line: number; col: number; message: string };

const SCRIPT_EXT = /\.(m?[jt]sx?|c[jt]s)$/i;

/** The first syntax error in JS/JSX/TS/TSX source, or null. `lineOffset` places a <script> block in its page. */
export function scriptError(name: string, text: string, lineOffset = 0): SyntaxError_ | null {
  const t = loadTs();
  if (!t) return null;
  const first = (fileName: string) => {
    const out = t.transpileModule(text, { fileName, reportDiagnostics: true, compilerOptions: { jsx: t.JsxEmit.Preserve, target: t.ScriptTarget.ESNext, module: t.ModuleKind.ESNext } });
    const d = out.diagnostics?.find((x) => x.category === t.DiagnosticCategory.Error && x.start !== undefined);
    if (!d || !d.file) return null;
    const p = d.file.getLineAndCharacterOfPosition(d.start!);
    return { line: p.line + 1 + lineOffset, col: p.character + 1, message: t.flattenDiagnosticMessageText(d.messageText, " ") };
  };
  const e = first(name);
  // plenty of React projects keep JSX in .js files: an error that goes away when read as JSX isn't one
  if (e && /\.[cm]?js$/i.test(name) && !first(name.replace(/\.[cm]?js$/i, ".jsx"))) return null;
  return e;
}

/** The inline <script> blocks of a page that hold JavaScript (or JSX for Babel), with the line each starts on. */
function inlineScripts(html: string) {
  const out: { code: string; line: number; jsx: boolean }[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(m[1])?.[1]?.toLowerCase() ?? "";
    if (/\bsrc\s*=/i.test(m[1]) || !m[2].trim()) continue;
    const jsx = /babel|jsx/.test(type);
    if (type && !jsx && !/^(module|text\/javascript|application\/javascript)$/.test(type)) continue; // JSON, templates, importmaps
    const before = html.slice(0, m.index! + m[0].indexOf(">") + 1);
    out.push({ code: m[2], line: before.split("\n").length - 1, jsx });
  }
  return out;
}

/** Braces that don't pair up in a stylesheet (comments and strings aside): a missing "}" swallows every rule after it. */
export function cssError(text: string): SyntaxError_ | null {
  const s = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, (m) => " ".repeat(m.length));
  let depth = 0, line = 1, openLine = 0;
  for (const ch of s) {
    if (ch === "\n") line++;
    else if (ch === "{") { if (!depth) openLine = line; depth++; }
    else if (ch === "}") { if (!depth) return { line, col: 1, message: "a \"}\" with no \"{\" before it" }; depth--; }
  }
  if (/\/\*/.test(s)) return { line: s.slice(0, s.indexOf("/*")).split("\n").length, col: 1, message: "a /* comment that is never closed" };
  return depth ? { line: openLine, col: 1, message: "a \"{\" that is never closed (every rule after it is lost)" } : null;
}

export function jsonError(text: string): SyntaxError_ | null {
  try { JSON.parse(text); return null; } catch (e) {
    // Node's message quotes the text but not always where it broke: TypeScript's JSON parser says where
    const msg = (e as Error).message.split("\n")[0].replace(/,\s*"?\.\.\..*$|, ".*$/, "");
    const t = loadTs();
    const d = t ? (t.parseJsonText("x.json", text) as unknown as { parseDiagnostics?: TS.Diagnostic[] }).parseDiagnostics?.[0] : undefined;
    const line = d?.start !== undefined ? text.slice(0, d.start).split("\n").length : 1;
    return { line, col: 1, message: d ? t!.flattenDiagnosticMessageText(d.messageText, " ") : msg };
  }
}

/** The syntax errors in a written file (empty when it parses, or isn't a kind that's checked). */
export function syntaxErrors(rel: string, text: string): SyntaxError_[] {
  const name = rel.replace(/\\/g, "/");
  if (/(^|\/)node_modules\//.test(name)) return [];
  if (SCRIPT_EXT.test(name) && !/\.d\.ts$/i.test(name)) { const e = scriptError(name, text); return e ? [e] : []; }
  if (/\.css$/i.test(name)) { const e = cssError(text); return e ? [e] : []; }
  // tsconfig and editor settings allow comments; package-lock is written by npm
  if (/\.json$/i.test(name) && !/(^|\/)(tsconfig[^/]*|jsconfig[^/]*|package-lock|\.vscode\/[^/]+)\.json$/i.test(name)) { const e = jsonError(text); return e ? [e] : []; }
  if (/\.html?$/i.test(name)) {
    const out: SyntaxError_[] = [];
    for (const sc of inlineScripts(text)) {
      const e = scriptError(sc.jsx ? "inline.jsx" : "inline.js", sc.code, sc.line);
      if (e) out.push({ ...e, message: `in a <script>: ${e.message}` });
    }
    for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
      const e = cssError(m[1]);
      if (e) out.push({ ...e, line: e.line + text.slice(0, m.index! + m[0].indexOf(">") + 1).split("\n").length - 1, message: `in a <style>: ${e.message}` });
    }
    return out;
  }
  return [];
}

// the same error on the same line of code (its number shifts as lines are added above it)
const key = (text: string) => (e: SyntaxError_) => `${e.message}|${text.split("\n")[e.line - 1]?.trim()}`;

/**
 * What to tell the agent about the file it just wrote: nothing when it parses. After an edit, only an
 * error the edit brought in (one that was already there was already reported, and a change made in
 * several edits may pass through a broken state, so it's said once, gently).
 */
export function syntaxNote(rel: string, after: string, before?: string): string {
  const errs = syntaxErrors(rel, after);
  if (!errs.length) return "";
  if (before !== undefined) {
    const had = new Set(syntaxErrors(rel, before).map(key(before)));
    if (errs.every((e) => had.has(key(after)(e)))) return "";
  }
  const list = errs.slice(0, 3).map((e) => `line ${e.line}${e.col > 1 ? `:${e.col}` : ""}: ${e.message.replace(/\.$/, "")}`).join("; ");
  return `\n\n⚠ ${rel} doesn't parse now — ${list}. ${before !== undefined ? "Unless you're midway through a change made in several edits, fix" : "Fix"} it with edit_file before anything else (it breaks the whole file, not just that line).`;
}

/**
 * The project's own type check (tsc --noEmit with its tsconfig and its own TypeScript), keeping only
 * errors in the files given: errors that were there before this task aren't the agent's to fix now.
 * null when the project has no tsconfig or no TypeScript installed, or the check couldn't run.
 */
export async function projectTypeErrors(root: string, changed: string[], timeoutMs = 120_000): Promise<string[] | null> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(path.join(root, "tsconfig.json")) || !fs.existsSync(tsc)) return null;
  const { execFile } = await import("node:child_process");
  const out = await new Promise<string | null>((resolve) => {
    execFile(process.execPath, [tsc, "--noEmit", "--pretty", "false", "-p", "."], { cwd: root, timeout: timeoutMs, maxBuffer: 8 << 20, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
      (err, stdout) => resolve(err && (err as { killed?: boolean }).killed ? null : String(stdout ?? "")));
  });
  if (out === null) return null;
  const slash = (f: string) => f.replace(/\\/g, "/");
  const mine = new Set(changed.map(slash));
  return out.split(/\r?\n/).filter((l) => / error TS\d+:/.test(l) && mine.has(slash(l.slice(0, l.indexOf("(")))));
}
