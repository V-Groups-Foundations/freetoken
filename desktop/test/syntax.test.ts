// Syntax checks on what the agent writes: a parser finds the slip the moment the file is written.
import { syntaxErrors, syntaxNote } from "../src/main/syntax";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}

const lines = (rel: string, text: string) => syntaxErrors(rel, text).map((e) => e.line);

(async () => {
  await check("JS, JSX (also in a .js file), TS and TSX: a broken file is found, with its line; a good one passes", async () => {
    const got = {
      js: lines("app.js", "const a = 1;\nfunction f() {\n  return a +;\n}\n"),
      jsOk: lines("app.js", "export const add = (a, b) => a + b;\n"),
      jsxInJs: lines("src/App.js", "export default function App() {\n  return <div className=\"x\">hi</div>;\n}\n"),
      jsx: lines("src/App.jsx", "export default function App() {\n  return <div>hi</span>;\n}\n"),
      ts: lines("a.ts", "type T = { a: number };\nconst x: T = { a: 1 ;\n"),
      tsx: lines("a.tsx", "export const A = ({ n }: { n: number }) => <b>{n}</b>;\n"),
      dts: lines("types.d.ts", "declare const x: number;\n"),
    };
    const want = { js: [3], jsOk: [], jsxInJs: [], jsx: [2], ts: [2], tsx: [], dts: [] };
    return JSON.stringify(got) === JSON.stringify(want) || JSON.stringify(got);
  });

  await check("an HTML page: its inline scripts and styles are checked, at the page's own line numbers; JSON scripts and src= are left alone", async () => {
    const page = [
      "<!DOCTYPE html>", "<html>", "<head>", "<style>", ".a { color: red; }", ".b { color: blue;", "</style>", "</head>", "<body>",
      '<script type="application/json">{"not": js}</script>',
      '<script src="app.js"></script>',
      "<script>", "  const items = [1, 2];", "  items.forEach((i) => {", "    console.log(i)", "  ;", "</script>",
      '<script type="text/babel">const A = () => <div>ok</div>;</script>',
      "</body>", "</html>",
    ].join("\n");
    const errs = syntaxErrors("index.html", page);
    return (errs.length === 2 && errs.some((e) => e.line === 6 && /<style>/.test(e.message)) && errs.some((e) => e.line >= 13 && e.line <= 17 && /<script>/.test(e.message)))
      || JSON.stringify(errs);
  });

  await check("CSS braces (comments and strings aside) and JSON; tsconfig comments and node_modules aren't flagged", async () => {
    const got = {
      css: lines("style.css", "a { color: red; }\n/* } */\n.b { content: \"}\"; \n.c { x: 1; }\n"),
      cssOk: lines("style.css", "@media (max-width: 600px) { .a { b: c; } }\n"),
      cssStray: lines("style.css", ".a { }\n}\n"),
      json: lines("data.json", '{\n  "a": 1,\n  "b": \n}\n'),
      tsconfig: lines("tsconfig.json", "{\n  // comment\n  \"compilerOptions\": {}\n}\n"),
      vendored: lines("node_modules/x/index.js", "this is not js("),
    };
    const want = { css: [3], cssOk: [], cssStray: [2], json: [4], tsconfig: [], vendored: [] };
    return JSON.stringify(got) === JSON.stringify(want) || JSON.stringify(got);
  });

  await check("the note: said when a write breaks a file; after an edit only when the edit brought the error in", async () => {
    const good = "const a = 1;\n", bad = "const a = ;\n", laterBroken = "const a = 1;\nconst b = (;\n", worse = "const a = ;\nconst b = (;\n";
    const written = syntaxNote("a.js", bad);
    const editedIn = syntaxNote("a.js", bad, good);
    const alreadyThere = syntaxNote("a.js", bad, bad);
    const anotherOne = syntaxNote("a.js", worse, laterBroken);
    return (/a\.js doesn't parse now — line 1/.test(written) && /^\n\n⚠/.test(written) && /midway through a change/.test(editedIn)
      && alreadyThere === "" && /line 1/.test(anotherOne) && syntaxNote("a.js", good) === "" && syntaxNote("notes.md", "{{{") === "")
      || JSON.stringify({ written, editedIn, alreadyThere, anotherOne });
  });

  console.log(failures ? `\n${failures} failed` : "\nall syntax checks passed");
  process.exit(failures ? 1 : 0);
})();
