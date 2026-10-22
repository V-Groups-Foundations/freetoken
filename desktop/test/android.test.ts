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

  await check("the prerequisite check finds Java 21 and the SDK, or says exactly what to install", async () => {
    const c = await android.checkAndroid();
    const consistent = (!!c.java && c.java.version >= 21) === !c.problems.some((p) => /Java/.test(p)) && !!c.sdk === !c.problems.some((p) => /SDK/.test(p));
    return (consistent && c.problems.every((p) => /Android Studio/.test(p))) || JSON.stringify(c);
  });

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
