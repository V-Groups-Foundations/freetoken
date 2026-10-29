// The second opinion: what the reviewing model is shown, and how its answer is read.
import { changesForReview, parseReview, reviewFindings } from "../src/main/review";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}

(async () => {
  await check("the reviewer sees each changed file's diff, new files whole with line numbers, images named (not shown), no lockfiles or node_modules", async () => {
    const now: Record<string, string | null> = {
      "app.js": "const a = 1;\nconst b = 3;\nexport { a, b };\n",
      "index.html": "<h1>Hi</h1>\n",
      "gone.css": null,
      "same.txt": "x\n",
      "images/hero.jpg": "binary",
      "package-lock.json": "{}",
      "node_modules/x/i.js": "y",
    };
    const files = new Map<string, string | null>([
      ["app.js", "const a = 1;\nconst b = 2;\nexport { a, b };\n"], ["index.html", null], ["gone.css", "a{}\n"], ["same.txt", "x\n"],
      ["images/hero.jpg", null], ["package-lock.json", "{}"], ["node_modules/x/i.js", null],
    ]);
    const text = await changesForReview(files, async (rel) => now[rel] ?? null);
    const ok = /--- app\.js \(\+1 −1\)/.test(text) && /^-\s*2 const b = 2;$/m.test(text) && /^\+\s*2 const b = 3;$/m.test(text)
      && /--- index\.html \(new file\)\n {3}1 {2}<h1>Hi<\/h1>/.test(text) && /--- gone\.css \(deleted\)/.test(text)
      && /--- images\/hero\.jpg \(new image, binary — exists, not shown\)/.test(text) && !/same\.txt|package-lock|node_modules/.test(text);
    return ok || text;
  });

  await check("a diff over budget leaves the rest out by name instead of cutting a file in half", async () => {
    const files = new Map<string, string | null>([["a.js", null], ["b.js", null]]);
    const text = await changesForReview(files, async () => "x\n".repeat(200), 3000);
    return (/--- a\.js \(new file\)/.test(text) && /--- b\.js \(left out/.test(text)) || text;
  });

  await check("the answer: JSON (also fenced or after thinking) is read, at most 5 issues; anything else claims nothing", async () => {
    const a = parseReview('<think>let me look</think>```json\n{"issues":[{"file":"app.js","line":"12","problem":"total ignores qty","fix":"multiply by qty"}]}\n```');
    const none = parseReview('{"issues": []}');
    const many = parseReview(JSON.stringify({ issues: Array.from({ length: 8 }, (_, i) => ({ file: "f", problem: `p${i}` })) }));
    const junk = [parseReview("Looks good to me!"), parseReview('{"verdict":"ok"}'), parseReview('{"issues":[{"oops":1}]}')];
    return (JSON.stringify(a) === JSON.stringify([{ file: "app.js", line: 12, problem: "total ignores qty", fix: "multiply by qty" }])
      && none?.length === 0 && many?.length === 5 && junk[0] === null && junk[1] === null && junk[2]?.length === 0)
      || JSON.stringify({ a, none, many, junk });
  });

  await check("the findings tell the agent where, what and how to fix — and to check each, since a reviewer can be wrong", async () => {
    const t = reviewFindings([{ file: "app.js", line: 12, problem: "total ignores qty.", fix: "multiply by qty" }, { file: "index.html", problem: "no month filter" }]);
    return (/1\. app\.js:12 — total ignores qty\. Fix: multiply by qty/.test(t) && /2\. index\.html — no month filter/.test(t) && /Skip the ones that are wrong without mentioning them/.test(t)) || t;
  });

  console.log(failures ? `\n${failures} failed` : "\nall review checks passed");
  process.exit(failures ? 1 : 0);
})();
