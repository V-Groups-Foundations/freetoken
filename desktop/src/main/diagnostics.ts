// Type errors the moment a file is written, the way an editor's language server shows them: the agent
// used to learn about a wrong import or a misspelled property only from the tsc gate at the very end (or
// never, in a project without a build). A TypeScript language service per project, kept warm between
// edits, answers for the one file just written — its own errors only, not the whole project's backlog.
import fs from "node:fs";
import path from "node:path";
import type * as TS from "typescript";

let ts: typeof TS | null | undefined;
function loadTs(): typeof TS | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  if (ts === undefined) { try { ts = require("typescript") as typeof TS; } catch { ts = null; } }
  return ts;
}

type Project = { ls: TS.LanguageService; versions: Map<string, number>; names: string[]; options: TS.CompilerOptions; config: string; mtime: number };
const projects = new Map<string, Project>();
const MAX_FILES = 3000; // a huge project: the first check would take too long to be worth it per edit

function project(root: string): Project | null {
  const t = loadTs();
  if (!t) return null;
  const config = ["tsconfig.json", "jsconfig.json"].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  if (!config) return null;
  const mtime = fs.statSync(config).mtimeMs;
  const cached = projects.get(root);
  if (cached && cached.config === config && cached.mtime === mtime) return cached;
  const read = t.readConfigFile(config, t.sys.readFile);
  if (read.error) return null;
  const parsed = t.parseJsonConfigFileContent(read.config, t.sys, root, undefined, config);
  if (parsed.fileNames.length > MAX_FILES) return null;
  const versions = new Map<string, number>();
  const names = parsed.fileNames.map((f) => path.resolve(f));
  const host: TS.LanguageServiceHost = {
    getScriptFileNames: () => names,
    getScriptVersion: (f) => String(versions.get(path.resolve(f)) ?? 0),
    getScriptSnapshot: (f) => { try { return t.ScriptSnapshot.fromString(fs.readFileSync(f, "utf8")); } catch { return undefined; } },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (o) => t.getDefaultLibFilePath(o),
    fileExists: t.sys.fileExists, readFile: t.sys.readFile, readDirectory: t.sys.readDirectory,
    directoryExists: t.sys.directoryExists, getDirectories: t.sys.getDirectories,
  };
  const p: Project = { ls: t.createLanguageService(host, t.createDocumentRegistry()), versions, names, options: parsed.options, config, mtime };
  projects.set(root, p);
  return p;
}

/**
 * The type errors in one file, just after it was written ("L12: Property 'nmae' does not exist…"), or null
 * when this file isn't type-checked here (no tsconfig/jsconfig, a JS file without checkJs, TypeScript
 * missing). At most `max` errors.
 */
export function typeErrors(root: string, rel: string, max = 8): string[] | null {
  const t = loadTs();
  if (!t || !/\.(m|c)?(ts|tsx|js|jsx)$/i.test(rel) || /\.d\.ts$/i.test(rel)) return null;
  const p = project(root);
  if (!p) return null;
  const abs = path.resolve(root, rel);
  const isJs = /\.(m|c)?jsx?$/i.test(rel);
  if (isJs && !p.options.checkJs) return null;
  if (!p.names.includes(abs)) {
    // a new file the config's include pattern covers (or not: then it isn't part of this project)
    const dirIncluded = p.names.some((n) => path.dirname(n) === path.dirname(abs)) || p.names.length === 0;
    if (!dirIncluded) return null;
    p.names.push(abs);
  }
  p.versions.set(abs, (p.versions.get(abs) ?? 0) + 1);
  try {
    const diags = [...p.ls.getSyntacticDiagnostics(abs), ...p.ls.getSemanticDiagnostics(abs)].filter((d) => d.category === t.DiagnosticCategory.Error);
    return diags.slice(0, max).map((d) => {
      const pos = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
      return `${pos ? `L${pos.line + 1}:${pos.character + 1}: ` : ""}${t.flattenDiagnosticMessageText(d.messageText, " ")}`;
    }).concat(diags.length > max ? [`…and ${diags.length - max} more`] : []);
  } catch { return null; }
}

/** The note for the agent after a write: the file's type errors, if any. */
export function typeNote(root: string | null, rel: string): string {
  if (!root) return "";
  const errs = typeErrors(root, rel);
  return errs?.length ? `\n\nType errors in ${rel} now (from the TypeScript language service — fix them):\n${errs.join("\n")}` : "";
}

/** Forget a project's state (its folder closed or its config changed). */
export const resetDiagnostics = (root?: string) => { if (root) projects.delete(root); else projects.clear(); };
