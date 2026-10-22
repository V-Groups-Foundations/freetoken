// Snapshots of a project in a private git repository: taken, listed, restored (and the restore undone),
// without touching the project's own .git.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as history from "../src/main/history";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}

(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-history-"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-proj-"));
  const w = (f: string, t: string) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
  const r = (f: string) => (fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), "utf8") : null);
  history.setHistoryDir(data);

  await check("snapshots record changes, skip no-ops, ignore node_modules and big files, and leave the project's .git alone", async () => {
    w("index.html", "<h1>v1</h1>"); w("app.js", "let a = 1;"); w("node_modules/x/index.js", "dep"); w(".git/HEAD", "ref: refs/heads/main\n");
    const first = await history.snapshot(root, "Before: build the page");
    const none = await history.snapshot(root, "nothing changed");
    w("index.html", "<h1>v2</h1>");
    const second = await history.snapshot(root, "Step done: header");
    const list = await history.list(root);
    const tracked = await history.changedSince(root, first!.id);
    return (!!first && none === null && !!second && list.length === 2 && list[0].label === "Step done: header" && list[0].files === 1
      && !tracked.some((t) => t.path.startsWith("node_modules")) && r(".git/HEAD") === "ref: refs/heads/main\n")
      || JSON.stringify({ first, none, second, list, tracked });
  });

  await check("restoring brings back changed and deleted files, removes new ones, and can itself be undone", async () => {
    const [, before] = await history.list(root); // "Before: build the page" (v1)
    w("index.html", "<h1>broken</h1>"); fs.rmSync(path.join(root, "app.js")); w("src/new.js", "new file");
    const res = await history.restore(root, before.id);
    const restored = r("index.html") === "<h1>v1</h1>" && r("app.js") === "let a = 1;" && r("src/new.js") === null;
    const undo = await history.restore(root, res.undo!);
    const undone = r("index.html") === "<h1>broken</h1>" && r("app.js") === null && r("src/new.js") === "new file";
    return (restored && undone && res.removed.includes("src/new.js") && r("node_modules/x/index.js") === "dep") || JSON.stringify({ res, restored, undone, idx: r("index.html") });
  });

  await check("restoring undoes a rename (it used to leave both the old and the new file)", async () => {
    w("page.js", "export const page = 1;");
    const snap = await history.snapshot(root, "Before: rename");
    fs.renameSync(path.join(root, "page.js"), path.join(root, "screen.js"));
    await history.restore(root, snap!.id);
    return (r("page.js") === "export const page = 1;" && r("screen.js") === null) || JSON.stringify({ page: r("page.js"), screen: r("screen.js") });
  });

  await check("bad ids are refused; without a history folder nothing happens", async () => {
    const bad = await history.restore(root, "; rm -rf /").then(() => "accepted", (e) => (e as Error).message);
    history.setHistoryDir(null);
    const off = await history.snapshot(root, "x");
    history.setHistoryDir(data);
    return (bad === "Not a snapshot id." && off === null) || JSON.stringify({ bad, off });
  });

  console.log(failures ? `\n${failures} failed` : "\nall history checks passed");
  process.exit(failures ? 1 : 0);
})();
