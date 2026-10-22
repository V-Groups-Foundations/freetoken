// Pasted / dropped attachments and skills picked for a message, through the real FreeToken agent loop.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFakeOpenAI } from "./fake-openai";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}${typeof r === "string" ? `: ${r}` : ""}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}: ${(e as Error).stack}`); }
}
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

(async () => {
  process.env.VRUN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-home-")); // only built-in skills
  const ws = await import("../src/main/workspace");
  const ft = await import("../src/main/ai-freetoken");
  const { prepareAttachments } = await import("../src/main/attachments");
  const fake = await startFakeOpenAI("ft_test");
  ft.configureFreeToken({ url: () => fake.url, token: () => "ft_test", model: () => "auto-smart" });
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-att-"));
  ws.setRoot(proj);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-outside-"));
  fs.writeFileSync(path.join(outside, "prices.csv"), "item,price\ntea,3\n");
  fs.writeFileSync(path.join(outside, "spec.pdf"), Buffer.from("%PDF-1.4 fake"));

  await check("attachments are saved in .v-run/uploads; images become image input, text files are included", async () => {
    const r = await prepareAttachments([
      { name: "image.png", mime: "image/png", data: PNG },
      { name: "prices.csv", path: path.join(outside, "prices.csv") },
      { name: "spec.pdf", path: path.join(outside, "spec.pdf") },
      { name: "gone.txt", path: path.join(outside, "missing.txt") },
    ]);
    const saved = fs.readdirSync(path.join(proj, ".v-run", "uploads"));
    return r.images.length === 1 && r.images[0].mime === "image/png" && r.texts.length === 1 && r.texts[0].includes("tea,3")
      && saved.some((f) => f.endsWith("-image.png")) && saved.some((f) => f.endsWith("-spec.pdf"))
      && r.note.includes("pdf file") && r.note.includes("gone.txt: couldn't be read") || JSON.stringify({ r: { ...r, images: r.images.length }, saved });
  });

  await check("an image goes to the model as an image part, then later turns only keep a note", async () => {
    const before = fake.requests.length;
    await ft.chatFreeToken({ sessionId: "att1", mode: "ask", text: "What is in this screenshot?", attachments: [{ name: "shot.png", mime: "image/png", data: PNG }] }, () => {});
    const first = fake.requests[before];
    const user = first.messages.find((m: any) => m.role === "user");
    const hasImage = Array.isArray(user.content) && user.content.some((p: any) => p.type === "image_url" && String(p.image_url.url).startsWith("data:image/png;base64,"));
    const text = Array.isArray(user.content) ? user.content.find((p: any) => p.type === "text").text : "";
    await ft.chatFreeToken({ sessionId: "att1", mode: "ask", text: "And now?" }, () => {});
    const second = fake.requests[fake.requests.length - 1];
    const old = second.messages.find((m: any) => m.role === "user");
    return hasImage && text.includes(".v-run/uploads/") && typeof old.content === "string" && old.content.includes("image was shown") || JSON.stringify(user).slice(0, 300);
  });

  await check("a skill picked for the message is loaded into it", async () => {
    const before = fake.requests.length;
    await ft.chatFreeToken({ sessionId: "att2", mode: "ask", text: "Make me an intro", skills: ["html-video"] }, () => {});
    const user = fake.requests[before].messages.find((m: any) => m.role === "user");
    return String(user.content).includes('The user chose the skill "html-video"') && String(user.content).includes("window.__video");
  });

  await check("a matching skill loads by itself (and once): the chat is told which", async () => {
    const before = fake.requests.length;
    const events: any[] = [];
    await ft.chatFreeToken({ sessionId: "auto1", mode: "ask", text: "Make a 10 second animated intro video for my bakery" }, (e) => events.push(e));
    const user = fake.requests[before].messages.find((m: any) => m.role === "user");
    const used = events.find((e) => e.type === "skills_used");
    const again: any[] = [];
    await ft.chatFreeToken({ sessionId: "auto1", mode: "ask", text: "Make the intro video longer" }, (e) => again.push(e));
    const unrelated: any[] = [];
    await ft.chatFreeToken({ sessionId: "auto2", mode: "ask", text: "Thanks, that's all for today!" }, (e) => unrelated.push(e));
    return String(user.content).includes('The skill "html-video" matches this request') && used?.names?.includes("html-video") && used.auto === true
      && !again.some((e) => e.type === "skills_used") && !unrelated.some((e) => e.type === "skills_used") || JSON.stringify({ used, again: again.filter((e) => e.type === "skills_used"), unrelated: unrelated.filter((e) => e.type === "skills_used") });
  });

  await check("auto-matching picks the right built-in skill for everyday requests, and none for small talk", async () => {
    const { matchSkills } = await import("../src/main/skills");
    const cases: [string, string | null][] = [
      ["Build a landing page for my coffee shop", "landing-page"], ["Add login with email and password", "auth-security"],
      ["Make the hero section animate on scroll", "web-animation"], ["Create a REST API for todos with Express", "backend-api"],
      ["Make a snake game", "browser-game"], ["Show sales as a bar chart", "data-visualization"], ["Deploy this with Docker", "docker-deploy"],
      ["Write tests for utils.ts", "testing"], ["Make a 3D spinning product viewer", "threejs-3d"], ["Why is my page loading so slowly?", "web-performance"],
      ["Design a logo as SVG", "svg-graphics"], ["Set up a new React app", "react-app"], ["Fix the bug where the cart total is wrong", "debugging"],
      ["Make a 10 second animated intro video", "html-video"], ["Thanks, that's all!", null], ["What does this function do?", null],
    ];
    const wrong: string[] = [];
    for (const [q, want] of cases) {
      const got = (await matchSkills(q)).map((s) => s.name);
      if (want ? got[0] !== want : got.length) wrong.push(`${q} → ${got.join(",") || "none"} (want ${want ?? "none"})`);
    }
    // everyday words ("app", "website", "someone", "run") alone loaded android-app for "send someone the link"
    for (const q of ["run the app i want to send the link to someone and test it (website UI)", "is it necessary for the person to be on the same network as me? (website UI)"]) {
      const got = (await matchSkills(q)).map((s) => s.name);
      if (got.includes("android-app")) wrong.push(`${q} → ${got.join(",")} (want no android-app)`);
    }
    for (const [q, want] of [["Make an Android APK of my site", "android-app"], ["Detect which floor someone is on with Wi-Fi scanning", "android-app"]]) {
      const got = (await matchSkills(q)).map((s) => s.name);
      if (got[0] !== want) wrong.push(`${q} → ${got.join(",") || "none"} (want ${want})`);
    }
    return !wrong.length || wrong.join("; ");
  });

  fake.close();
  console.log(failures ? `\n${failures} failed` : "\nall attachment checks passed");
  process.exit(failures ? 1 : 0);
})();
