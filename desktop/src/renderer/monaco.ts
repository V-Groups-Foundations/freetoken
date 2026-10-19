// Load Monaco from the bundle (not a CDN) and wire its language workers through Vite.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import CssWorker from "monaco-editor/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";

self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};
loader.config({ monaco });
// Monaco cancels in-flight work (hover, highlights, quick-open lookups) when you switch files; the
// rejected promises carry a "Canceled" error that nothing needs to handle, so don't report them.
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason as { name?: string; message?: string } | undefined;
  if (r && (r.name === "Canceled" || r.message === "Canceled")) e.preventDefault();
});

monaco.editor.defineTheme("cursor-dark", {
  base: "vs-dark", inherit: true, rules: [],
  colors: { "editor.background": "#181818", "editorGutter.background": "#181818", "editor.lineHighlightBackground": "#ffffff08" },
});

const EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", mdc: "markdown", css: "css", scss: "scss", less: "less", html: "html", htm: "html", py: "python", rs: "rust",
  go: "go", java: "java", kt: "kotlin", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", rb: "ruby", php: "php", sh: "shell", ps1: "powershell",
  yml: "yaml", yaml: "yaml", toml: "ini", ini: "ini", sql: "sql", xml: "xml", svg: "xml", swift: "swift", lua: "lua", dart: "dart", vue: "html",
};
export const languageOf = (path: string) => EXT[path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
export { monaco };
