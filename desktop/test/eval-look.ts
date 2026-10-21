// Open a built project's index.html in Chrome: screenshot + every error (page, console, failed loads).
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  try {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errs: string[] = [];
    p.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
    p.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 200)}`); });
    p.on("requestfailed", (r) => errs.push(`request failed: ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
    await p.goto(pathToFileURL(path.join(process.argv[2], "index.html")).href, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => errs.push(`goto: ${e.message}`));
    await p.waitForTimeout(4000);
    await p.screenshot({ path: path.join(process.argv[3], process.argv[4]) });
    console.log("errors:", errs.length ? "\n  " + errs.slice(0, 12).join("\n  ") : "none");
  } finally { await b.close(); }
})();
