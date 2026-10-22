// Publish: what gets published (build step, output folder, server parts), what's staged, and the
// command sequence for each host (run here through a stand-in for the CLIs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ws from "../src/main/workspace";
import * as pub from "../src/main/publish";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string> | boolean | string) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}
const project = (files: Record<string, string>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-pub-"));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); }
  ws.setRoot(root);
  return root;
};
// a stand-in for npm / wrangler / netlify: answers like the real CLIs, records what was run
function fakeExec(answers: { loggedIn: boolean; fail?: RegExp }) {
  const ran: string[] = [];
  const exec = async (cmd: string, _cwd: string, log: (l: string) => void) => {
    ran.push(cmd);
    log(`$ ${cmd}`);
    if (answers.fail?.test(cmd)) return { code: 1, out: "boom" };
    if (/whoami|status$/.test(cmd)) return answers.loggedIn ? { code: 0, out: "You are logged in with an OAuth Token" } : { code: 1, out: "You are not authenticated. Please run `wrangler login`." };
    if (/pages project create/.test(cmd)) return { code: 1, out: "A project with this name already exists [code: 8000002]" };
    if (/pages deploy/.test(cmd)) return { code: 0, out: "✨ Deployment complete! Take a peek over at https://4f2a.my-tracker.pages.dev" };
    if (/netlify-cli@27 deploy/.test(cmd)) return { code: 0, out: 'Deploying...\n{"site_id":"x","url":"https://my-tracker.netlify.app","deploy_url":"https://abc--my-tracker.netlify.app"}' };
    return { code: 0, out: "" };
  };
  return { exec, ran };
}

(async () => {
  await check("the plan: a plain site publishes its own folder; a Vite app builds into dist; a server part is pointed out", () => {
    project({ "index.html": "<h1>hi</h1>", "server.js": "require('http')", "package.json": JSON.stringify({ name: "My Tracker!" }) });
    const plain = pub.planPublish();
    project({ "package.json": JSON.stringify({ name: "vite-app", scripts: { build: "vite build" } }), "src/main.js": "" });
    const vite = pub.planPublish();
    project({ "README.md": "nothing here" });
    const none = pub.planPublish();
    return (plain.dir === "." && plain.build === null && plain.name === "my-tracker" && plain.server === "server.js" && !plain.problem
      && vite.build === "npm run build" && vite.dir === "dist" && !!none.problem && none.dir === null) || JSON.stringify({ plain, vite, none });
  });

  await check("staging the project folder leaves out node_modules, .git, .v-run, .env files, notes and package files", () => {
    const root = project({ "index.html": "<h1>hi</h1>", "app.js": "x", "img/a.png": "png", "node_modules/x/i.js": "", ".git/HEAD": "", ".v-run/checks/a.json": "{}", ".env": "SECRET=1", "README.md": "", "package.json": "{}", "V.md": "" });
    const into = pub.stageSite(root, path.join(root, ".v-run", "tmp", "site"));
    const got = fs.readdirSync(into).sort();
    return JSON.stringify(got) === JSON.stringify(["app.js", "img", "index.html"]) || JSON.stringify(got);
  });

  await check("Cloudflare Pages: signs in when needed, creates the project (ok if it exists), deploys, records the address", async () => {
    const root = project({ "index.html": "<h1>hi</h1>" });
    const { exec, ran } = fakeExec({ loggedIn: false });
    const log: string[] = [];
    const rec = await pub.publish({ provider: "cloudflare", name: "My Tracker", build: null, dir: "." }, (l) => log.push(l), exec as any);
    const saved = pub.lastPublish(root);
    return (rec.url === "https://my-tracker.pages.dev" && saved?.url === rec.url
      && ran.some((c) => c.endsWith("wrangler@4 login")) && ran.some((c) => /pages deploy ".*site" --project-name my-tracker --branch main/.test(c))
      && log.at(-1) === "Published: https://my-tracker.pages.dev") || JSON.stringify({ rec, ran });
  });

  await check("Netlify: deploys straight away when signed in; builds first when the project has a build step", async () => {
    project({ "package.json": JSON.stringify({ scripts: { build: "vite build" } }), "node_modules/.keep": "", "dist/index.html": "<h1>built</h1>" });
    const { exec, ran } = fakeExec({ loggedIn: true });
    const rec = await pub.publish({ provider: "netlify", name: "my-tracker", build: "npm run build", dir: "dist" }, () => {}, exec as any);
    return (rec.url === "https://my-tracker.netlify.app" && ran[0] === "npm run build" && !ran.some((c) => /login/.test(c))
      && ran.some((c) => /deploy --prod --no-build --json --dir ".*dist" --site-name my-tracker/.test(c))) || JSON.stringify({ rec, ran });
  });

  await check("failures say what went wrong: a failed build, no index.html", async () => {
    project({ "package.json": JSON.stringify({ scripts: { build: "x" } }), "node_modules/.keep": "" });
    const { exec } = fakeExec({ loggedIn: true, fail: /npm run build/ });
    const build = await pub.publish({ provider: "cloudflare", name: "a", build: "npm run build", dir: "dist" }, () => {}, exec as any).then(() => "ok", (e) => (e as Error).message);
    project({ "x.txt": "" });
    const empty = await pub.publish({ provider: "cloudflare", name: "a", build: null, dir: "." }, () => {}, fakeExec({ loggedIn: true }).exec as any).then(() => "ok", (e) => (e as Error).message);
    return (/build failed/.test(build) && /no index\.html/.test(empty)) || JSON.stringify({ build, empty });
  });

  console.log(failures ? `\n${failures} failed` : "\nall publish checks passed");
  process.exit(failures ? 1 : 0);
})();
