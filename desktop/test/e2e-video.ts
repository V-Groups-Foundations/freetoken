// End-to-end: V-Run exports an HTML video to MP4, then Chrome plays the file back and we check that both
// a CSS animation and a render(t)-driven element are where they should be at two points in time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, _electron as electron } from "playwright-core";

const HTML = `<!doctype html><html><head><style>
html,body{margin:0;background:#000;overflow:hidden}
#stage{position:relative;width:640px;height:360px;background:#fff}
#css{position:absolute;top:40px;left:0;width:80px;height:80px;background:#f00;animation:slide 2s linear both}
#js{position:absolute;top:220px;left:0;width:80px;height:80px;background:#0a0}
@keyframes slide{from{transform:translateX(0)}to{transform:translateX(560px)}}
</style></head><body><div id="stage"><div id="css"></div><div id="js"></div></div>
<script>
window.__video = { duration: 2, render(t) { document.getElementById('js').style.transform = 'translateX(' + (t / 2 * 560) + 'px)'; } };
</script></body></html>`;

let failures = 0;
const check = async (name: string, fn: () => Promise<boolean | string>) => {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}${typeof r === "string" ? `: ${r}` : ""}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}: ${(e as Error).message.split("\n")[0]}`); }
};

(async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-video-"));
  fs.mkdirSync(path.join(proj, "video"));
  fs.writeFileSync(path.join(proj, "video", "index.html"), HTML);
  const app = await electron.launch({
    args: [".", "--intro=0"], cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, CURSOR_REMAKE_OPEN: proj, CURSOR_REMAKE_USER_DATA: fs.mkdtempSync(path.join(os.tmpdir(), "vrun-ud-")) },
  });
  app.process().stdout?.on("data", (d) => process.env.E2E_DEBUG && process.stdout.write(String(d)));
  app.process().stderr?.on("data", (d) => { const s = String(d); if (process.env.E2E_DEBUG || /crash|fatal|error/i.test(s)) process.stderr.write(s); });
  let result: any = null;
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!(window as any).api, null, { timeout: 60_000 });
    await page.waitForTimeout(2000);
    await check("exports an HTML video", async () => {
      const t0 = Date.now();
      result = await page.evaluate(() => (window as any).api.videoExport("video/index.html", { duration: 2, fps: 20, width: 640, height: 360 }));
      console.log(`      ${result.frames} frames → ${path.basename(result.file)} (${(result.bytes / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      return result.frames === 40 && result.bytes > 2000 && fs.existsSync(result.file);
    });
  } finally { await app.close(); }

  if (result?.file) {
    await check(`the file is a real ${result.ext.toUpperCase()}`, async () => {
      const head = fs.readFileSync(result.file).subarray(0, 12);
      return result.ext === "mp4" ? head.subarray(4, 8).toString() === "ftyp" : head.readUInt32BE(0) === 0x1a45dfa3;
    });
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.addInitScript("window.__name = (f) => f"); // tsx's keep-names helper, used in evaluated code
      await page.goto("about:blank");
      const data = fs.readFileSync(result.file).toString("base64");
      const probe = await page.evaluate(async ({ b64, mime }) => {
        const v = document.createElement("video");
        v.muted = true; v.preload = "auto"; document.body.appendChild(v);
        const within = <T,>(p: Promise<T>, what: string) => Promise.race([p, new Promise<T>((_, j) => setTimeout(() => j(new Error(`timed out: ${what}`)), 10_000))]);
        const loaded = new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error("can't decode")); });
        v.src = `data:${mime};base64,${b64}`;
        await within(loaded, "loading");
        const c = document.createElement("canvas"); c.width = 640; c.height = 360;
        const g = c.getContext("2d")!;
        // x of the box's centre: scan the row for its colour
        const find = (y: number, red: boolean) => {
          const row = g.getImageData(0, y, 640, 1).data;
          const xs: number[] = [];
          for (let x = 0; x < 640; x++) { const [r, gg, b] = [row[x * 4], row[x * 4 + 1], row[x * 4 + 2]]; if (red ? r > 180 && gg < 90 && b < 90 : gg > 110 && r < 90 && b < 90) xs.push(x); }
          return xs.length ? Math.round((xs[0] + xs[xs.length - 1]) / 2) : -1;
        };
        const at = async (t: number) => {
          const seeked = new Promise((r) => { v.onseeked = r; });
          v.currentTime = t;
          await within(seeked, `seeking to ${t}`);
          g.drawImage(v, 0, 0, 640, 360);
          return { red: find(80, true), green: find(260, false) };
        };
        return { duration: v.duration, early: await at(0.5), late: await at(1.5) };
      }, { b64: data, mime: result.ext === "mp4" ? "video/mp4" : "video/webm" });
      console.log(`      duration ${probe.duration.toFixed(2)} s; red x ${probe.early.red} → ${probe.late.red}; green x ${probe.early.green} → ${probe.late.green}`);
      // at t the box's centre is 40 + t/2·560 → 180 at 0.5 s, 460 at 1.5 s (a frame of slack each way)
      const near = (x: number, want: number) => Math.abs(x - want) <= 20;
      await check("lasts 2 seconds", async () => Math.abs(probe.duration - 2) < 0.15);
      await check("CSS animation follows the timeline", async () => near(probe.early.red, 180) && near(probe.late.red, 460) || JSON.stringify(probe));
      await check("render(t) follows the timeline", async () => near(probe.early.green, 180) && near(probe.late.green, 460) || JSON.stringify(probe));
    } finally { await browser.close(); }
  }
  console.log(failures ? `\n${failures} failed` : "\nall video checks passed");
  process.exit(failures ? 1 : 0);
})();
