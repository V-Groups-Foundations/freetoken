// Android app: prerequisites, the native Wi-Fi plugin (class, registration, permissions), the page
// bridge — and, with ANDROID_PREPARE_TEST=1, a real Capacitor 8 project prepared from a plain site.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ws from "../src/main/workspace";
import * as android from "../src/main/android";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string> | boolean | string) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}

(async () => {
  await check("app ids are valid Android package names", () => {
    const ids = [android.appIdFor("My Tracker!"), android.appIdFor("3d floors"), android.appIdFor("")];
    return ids.every((i) => /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(i)) && ids[0] === "com.vrun.mytracker" || JSON.stringify(ids);
  });

  await check("the prerequisite check finds Android Studio, the SDK and a Java the build tools run on (21–24), or says what's missing", async () => {
    const c = await android.checkAndroid();
    const javaOk = !!c.java && c.java.version >= 21 && c.java.version <= 24;
    const consistent = javaOk === !c.missing.java && javaOk === !c.problems.some((p) => /Java/.test(p))
      && !!c.sdk === !c.missing.sdk && (c.missing.studio === (!c.studio && !c.sdk));
    // anything missing either can be set up here, or comes with the download link
    const helpful = c.problems.every((p) => /Set up|developer\.android\.com\/studio|open Android Studio/.test(p));
    return (consistent && helpful) || JSON.stringify(c);
  });

  // Set up, with fakes: nothing is installed or downloaded for real; V-Run's tools folder is a temp home
  const realHome = process.env.USERPROFILE, realHOME = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-home-"));
  process.env.USERPROFILE = home; process.env.HOME = home;
  const state = (o: Partial<android.AndroidCheck["missing"]> & { installer?: "winget" | "brew" | null; at?: string }): android.AndroidCheck => {
    const { installer, at, ...flags } = o;
    const missing = { studio: false, java: false, sdk: false, ...flags };
    return { java: missing.java ? null : { home: "x", version: 21 }, sdk: missing.sdk ? null : "sdk", adb: null, studio: at ?? (missing.studio ? null : "studio64.exe"),
      installer: installer ?? null, missing, problems: Object.entries(missing).filter(([, v]) => v).map(([k]) => k) };
  };
  const noFetch = (() => { throw new Error("no download expected"); }) as unknown as typeof fetch;

  await check("set up: no way to install Android Studio here → the error gives the download link", async () => {
    try { await android.setupAndroid(() => {}, { check: async () => state({ studio: true, sdk: true }), fetchImpl: noFetch }); return "no error"; }
    catch (e) { return /developer\.android\.com\/studio/.test((e as Error).message) || (e as Error).message; }
  });

  await check("set up: installs Android Studio with winget, then opens it so its setup downloads the SDK", async () => {
    const ran: string[] = [], opened: string[] = [];
    const states = [state({ studio: true, sdk: true, installer: "winget" }), state({ sdk: true, at: "C:/AS/studio64.exe" }), state({ sdk: true, at: "C:/AS/studio64.exe" })];
    let i = 0;
    await android.setupAndroid(() => {}, { check: async () => states[Math.min(i++, states.length - 1)], exec: async (cmd) => { ran.push(cmd); return { code: 0, out: "" }; }, fetchImpl: noFetch, open: (s) => opened.push(s) });
    return (ran.length === 1 && /winget install --id Google\.AndroidStudio --exact/.test(ran[0]) && opened.join() === "C:/AS/studio64.exe") || JSON.stringify({ ran, opened });
  });

  await check("set up: a failed install says so and gives the download link", async () => {
    try { await android.setupAndroid(() => {}, { check: async () => state({ studio: true, sdk: true, installer: "winget" }), exec: async () => ({ code: 1, out: "" }), fetchImpl: noFetch }); return "no error"; }
    catch (e) { return /didn't work.*developer\.android\.com\/studio/.test((e as Error).message) || (e as Error).message; }
  });

  await check("set up: Java 21 is downloaded from Adoptium into V-Run's own tools folder and unpacked there", async () => {
    // a stand-in JDK archive: jdk-21.0.9+10/bin/java(.exe)
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-jdkzip-"));
    const top = path.join(src, "jdk-21.0.9+10", "bin");
    fs.mkdirSync(top, { recursive: true });
    fs.writeFileSync(path.join(top, process.platform === "win32" ? "java.exe" : "java"), "stand-in");
    const archive = path.join(src, process.platform === "win32" ? "jdk.zip" : "jdk.tar.gz");
    const tar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
    const { execFileSync } = await import("node:child_process");
    execFileSync(tar, process.platform === "win32" ? ["-a", "-cf", archive, "-C", src, "jdk-21.0.9+10"] : ["-czf", archive, "-C", src, "jdk-21.0.9+10"]);
    const urls: string[] = [];
    const fakeFetch = (async (u: string) => { urls.push(u); return new Response(fs.readFileSync(archive), { headers: { "content-length": String(fs.statSync(archive).size) } }); }) as unknown as typeof fetch;
    let n = 0;
    await android.setupAndroid(() => {}, { check: async () => (n++ === 0 ? state({ java: true }) : state({})), fetchImpl: fakeFetch, open: () => {} });
    const java = path.join(home, ".vrun", "tools", "jdk-21", "bin", process.platform === "win32" ? "java.exe" : "java");
    const leftovers = fs.readdirSync(path.join(home, ".vrun", "tools")).filter((f) => f !== "jdk-21");
    return (urls.length === 1 && urls[0] === android.jdkUrl() && /adoptium\.net\/v3\/binary\/latest\/21\/ga\//.test(urls[0]) && fs.existsSync(java) && leftovers.length === 0)
      || JSON.stringify({ urls, java: fs.existsSync(java), leftovers });
  });
  process.env.USERPROFILE = realHome; process.env.HOME = realHOME;

  await check("the Wi-Fi plugin is registered in MainActivity and gets its permissions (idempotent)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-and-"));
    const pkgDir = path.join(root, "android/app/src/main/java/com/vrun/tracker");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "MainActivity.java"), "package com.vrun.tracker;\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n");
    fs.writeFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application />\n    <uses-permission android:name="android.permission.INTERNET" />\n</manifest>\n');
    android.installWifiPlugin(root);
    android.installWifiPlugin(root); // twice: nothing doubles
    const act = fs.readFileSync(path.join(pkgDir, "MainActivity.java"), "utf8");
    const plugin = fs.readFileSync(path.join(pkgDir, "WifiScanPlugin.java"), "utf8");
    const xml = fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
    return (act.split("registerPlugin(WifiScanPlugin.class)").length === 2 && act.indexOf("registerPlugin") < act.indexOf("super.onCreate")
      && plugin.startsWith("package com.vrun.tracker;") && plugin.includes('name = "WifiScan"') && plugin.includes("@PluginMethod")
      && xml.split("ACCESS_FINE_LOCATION").length === 2 && xml.includes("CHANGE_WIFI_STATE") && xml.trim().endsWith("</manifest>")) || act + xml;
  });

  await check("the page bridge is added to the app's copy of the site once, and says plainly when it isn't in the app", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-www-"));
    fs.writeFileSync(path.join(dir, "index.html"), "<html><head><title>x</title></head><body></body></html>");
    android.addNativeBridge(dir); android.addNativeBridge(dir);
    const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
    // in a browser (no Capacitor): available() is false and scan() rejects
    const w: any = {};
    new Function("window", android.NATIVE_JS)(w);
    // in the app: scan() goes to the native plugin
    const calls: string[] = [];
    const app: any = { Capacitor: { getPlatform: () => "android", nativePromise: (p: string, m: string) => { calls.push(`${p}.${m}`); return Promise.resolve({ networks: [{ bssid: "aa:bb", level: -50 }] }); } } };
    new Function("window", android.NATIVE_JS)(app);
    return app.VRunWifi.scan().then((n: any[]) => (html.split("vrun-native.js").length === 2 && /<head>\s*<script src="vrun-native.js">/.test(html) && !w.VRunWifi.available()
      && app.VRunWifi.available() && calls[0] === "WifiScan.scan" && n[0].bssid === "aa:bb") || html);
  });

  if (process.env.ANDROID_PREPARE_TEST === "1") {
    await check("prepare (real): a plain site becomes a Capacitor 8 Android project with Wi-Fi scanning", async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "vrun-cap-"));
      fs.writeFileSync(path.join(root, "index.html"), "<html><head><title>Tracker</title></head><body><h1>Floors</h1></body></html>");
      ws.setRoot(root);
      const log: string[] = [];
      const r = await android.buildAndroid({ name: "Floor Tracker", build: false }, (l) => log.push(l));
      const assets = path.join(root, "android/app/src/main/assets/public");
      const ok = r.prepared && r.appId === "com.vrun.floortracker"
        && fs.existsSync(path.join(root, "android/app/src/main/java/com/vrun/floortracker/WifiScanPlugin.java"))
        && fs.readFileSync(path.join(root, "android/app/src/main/java/com/vrun/floortracker/MainActivity.java"), "utf8").includes("registerPlugin(WifiScanPlugin.class)")
        && fs.existsSync(path.join(assets, "vrun-native.js")) && fs.readFileSync(path.join(assets, "index.html"), "utf8").includes("vrun-native.js")
        && !fs.readFileSync(path.join(root, "index.html"), "utf8").includes("vrun-native.js"); // the project's own page is untouched
      return ok || `${JSON.stringify(r)}\n${log.slice(-15).join("\n")}`;
    });
  }

  console.log(failures ? `\n${failures} failed` : "\nall android checks passed");
  process.exit(failures ? 1 : 0);
})();
