// Android app: wrap the project's website in a native Android app with Capacitor 8, add what a web page
// can't do — scanning nearby Wi-Fi networks (for indoor/floor positioning) — and build an installable
// APK. The page calls the native side through vrun-native.js (window.VRunWifi.scan()), which V-Run adds
// to the app's copy of the site. Building needs JDK 21 and the Android SDK (both come with Android
// Studio); the check says exactly what's missing, and "Prepare" works without them.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRoot } from "./workspace";
import { killTree, windowsShell } from "./runner";
import { planPublish, siteName, stageSite } from "./publish";

const win = process.platform === "win32";
const CAP = "8"; // Capacitor major version: JDK 21, compileSdk 36, Android 7+ (API 24)

// ---------------------------------------------------------------- what's installed

function javaVersion(java: string): Promise<number | null> {
  return new Promise((resolve) => execFile(java, ["-version"], { windowsHide: true, timeout: 15_000 }, (e, out, err) => {
    const m = /version "(\d+)(?:\.(\d+))?/.exec(`${out}${err}`);
    resolve(e && !m ? null : m ? (m[1] === "1" ? Number(m[2]) : Number(m[1])) : null);
  }));
}

/** JDK candidates: JAVA_HOME, Android Studio's bundled one, then PATH. */
function javaCandidates() {
  const exe = win ? "java.exe" : "java";
  const homes = [process.env.JAVA_HOME,
    ...(win ? ["C:\\Program Files\\Android\\Android Studio\\jbr", path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Android Studio", "jbr")]
      : ["/Applications/Android Studio.app/Contents/jbr/Contents/Home", "/opt/android-studio/jbr", path.join(os.homedir(), "android-studio", "jbr")])].filter(Boolean) as string[];
  const fromHomes = homes.map((h) => ({ home: h, java: path.join(h, "bin", exe) })).filter((c) => fs.existsSync(c.java));
  const onPath = (process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, exe)).filter((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } })
    .map((java) => ({ home: path.dirname(path.dirname(java)), java }));
  return [...fromHomes, ...onPath];
}

export function findSdk(): string | null {
  const dirs = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    win ? path.join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk") : process.platform === "darwin" ? path.join(os.homedir(), "Library", "Android", "sdk") : path.join(os.homedir(), "Android", "Sdk")].filter(Boolean) as string[];
  return dirs.find((d) => fs.existsSync(path.join(d, "platforms")) || fs.existsSync(path.join(d, "platform-tools"))) ?? null;
}

export interface AndroidCheck { java: { home: string; version: number } | null; sdk: string | null; adb: string | null; problems: string[] }

export async function checkAndroid(): Promise<AndroidCheck> {
  let java: AndroidCheck["java"] = null;
  for (const c of javaCandidates()) {
    const v = await javaVersion(c.java);
    if (v && v >= 21) { java = { home: c.home, version: v }; break; }
    if (v && !java) java = { home: c.home, version: v };
  }
  const sdk = findSdk();
  const adbPath = sdk ? path.join(sdk, "platform-tools", win ? "adb.exe" : "adb") : null;
  const problems: string[] = [];
  const studio = "Install Android Studio (developer.android.com/studio) — it brings the Android SDK and Java — open it once so it finishes setting up, then try again.";
  if (!java) problems.push(`Java (JDK 21) isn't installed. ${studio}`);
  else if (java.version < 21) problems.push(`Java ${java.version} is too old — Android builds need JDK 21. ${studio}`);
  if (!sdk) problems.push(`The Android SDK isn't installed. ${studio}`);
  return { java: java && java.version >= 21 ? java : java, sdk, adb: adbPath && fs.existsSync(adbPath) ? adbPath : null, problems };
}

// ---------------------------------------------------------------- the native Wi-Fi plugin

/** Java source of the Wi-Fi scan plugin, in the app's package. */
export function wifiPluginJava(pkg: string) {
  return `package ${pkg};

import android.Manifest;
import android.content.Context;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Added by V-Run: lists nearby Wi-Fi access points (BSSID, SSID, signal strength), which a web page
 * can't do — the basis for indoor / floor positioning. Called from the page through vrun-native.js:
 * await VRunWifi.scan(). Android throttles real scans (4 per 2 minutes); between them it returns
 * the latest results it has.
 */
@CapacitorPlugin(
    name = "WifiScan",
    permissions = { @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }) }
)
public class WifiScanPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "afterPermission");
            return;
        }
        doScan(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) doScan(call);
        else call.reject("Location permission is needed to scan Wi-Fi networks.");
    }

    @SuppressWarnings("deprecation")
    private void doScan(PluginCall call) {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) { call.reject("This device has no Wi-Fi."); return; }
        if (!wifi.isWifiEnabled()) { call.reject("Wi-Fi is turned off."); return; }
        boolean fresh = wifi.startScan(); // false when Android throttles scans: the cached results still come back
        JSArray networks = new JSArray();
        for (ScanResult r : wifi.getScanResults()) {
            JSObject o = new JSObject();
            o.put("bssid", r.BSSID);
            o.put("ssid", r.SSID);
            o.put("level", r.level);
            o.put("frequency", r.frequency);
            networks.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("networks", networks);
        ret.put("fresh", fresh);
        ret.put("time", System.currentTimeMillis());
        call.resolve(ret);
    }
}
`;
}

/** The page side: window.VRunWifi, working in the Android app (and saying so plainly in a browser). */
export const NATIVE_JS = `// Added by V-Run for the Android app: native features a web page can't use on its own.
// In a normal browser VRunWifi.available() is false and scan() rejects.
(function () {
  var cap = window.Capacitor;
  var native = !!(cap && typeof cap.nativePromise === "function" && (!cap.getPlatform || cap.getPlatform() !== "web"));
  window.VRunWifi = {
    available: function () { return native; },
    /** Nearby Wi-Fi access points: [{ bssid, ssid, level (dBm), frequency (MHz) }] */
    scan: function () {
      if (!native) return Promise.reject(new Error("Wi-Fi scanning only works in the Android app."));
      return cap.nativePromise("WifiScan", "scan", {}).then(function (r) { return r.networks || []; });
    }
  };
})();
`;

const PERMISSIONS = ["android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_WIFI_STATE", "android.permission.CHANGE_WIFI_STATE"];

/** Add the plugin to an android/ project made by Capacitor: the class, its registration, the permissions. Idempotent. */
export function installWifiPlugin(root: string) {
  const javaRoot = path.join(root, "android", "app", "src", "main", "java");
  const find = (d: string): string | null => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { const r = find(p); if (r) return r; } else if (e.name === "MainActivity.java") return p;
    }
    return null;
  };
  const main = fs.existsSync(javaRoot) ? find(javaRoot) : null;
  if (!main) throw new Error("android/ has no MainActivity.java — remove the android folder and prepare again.");
  const pkg = /package\s+([\w.]+)\s*;/.exec(fs.readFileSync(main, "utf8"))?.[1];
  if (!pkg) throw new Error("Couldn't read the app's package from MainActivity.java.");
  fs.writeFileSync(path.join(path.dirname(main), "WifiScanPlugin.java"), wifiPluginJava(pkg));
  let act = fs.readFileSync(main, "utf8");
  if (!act.includes("registerPlugin(WifiScanPlugin.class)")) {
    if (/public class MainActivity extends BridgeActivity\s*\{\s*\}/.test(act)) {
      act = act.replace(/public class MainActivity extends BridgeActivity\s*\{\s*\}/, `public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(WifiScanPlugin.class); // added by V-Run: Wi-Fi scanning for the page
        super.onCreate(savedInstanceState);
    }
}`);
    } else if (/super\.onCreate\(/.test(act)) {
      act = act.replace(/(\s*)super\.onCreate\(/, `$1registerPlugin(WifiScanPlugin.class); // added by V-Run$1super.onCreate(`);
    } else throw new Error("MainActivity.java has been customised: add registerPlugin(WifiScanPlugin.class) before super.onCreate yourself.");
    fs.writeFileSync(main, act);
  }
  const manifest = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
  let xml = fs.readFileSync(manifest, "utf8");
  const missing = PERMISSIONS.filter((p) => !xml.includes(`"${p}"`));
  if (missing.length) {
    xml = xml.replace(/(\s*)<\/manifest>\s*$/, `${missing.map((p) => `\n    <uses-permission android:name="${p}" />`).join("")}\n</manifest>\n`);
    fs.writeFileSync(manifest, xml);
  }
  return { pkg, mainActivity: path.relative(root, main) };
}

/** Put vrun-native.js into the app's copy of the site and load it from index.html. */
export function addNativeBridge(webDir: string) {
  fs.writeFileSync(path.join(webDir, "vrun-native.js"), NATIVE_JS);
  const index = path.join(webDir, "index.html");
  let html = fs.readFileSync(index, "utf8");
  if (!html.includes("vrun-native.js")) {
    const tag = `<script src="vrun-native.js"></script>`;
    html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (h) => `${h}\n  ${tag}`) : `${tag}\n${html}`;
    fs.writeFileSync(index, html);
  }
}

// ---------------------------------------------------------------- building

type Log = (line: string) => void;
type Exec = (cmd: string, cwd: string, log: Log, env?: Record<string, string>) => Promise<{ code: number | null; out: string }>;
let current: ReturnType<typeof spawn> | null = null;

const run: Exec = (cmd, cwd, log, env) => new Promise((resolve) => {
  log(`$ ${cmd}`);
  const p = spawn(win ? windowsShell() : "/bin/bash", win ? ["-NoProfile", "-NonInteractive", "-Command", cmd] : ["-lc", cmd],
    { cwd, windowsHide: true, detached: !win, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env } });
  current = p;
  let out = "";
  const onData = (d: Buffer) => { const t = d.toString().replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ""); out += t; for (const l of t.split(/\r?\n/)) if (l.trim()) log(l); };
  p.stdout?.on("data", onData);
  p.stderr?.on("data", onData);
  p.on("error", (e) => { out += e.message; log(e.message); });
  p.on("close", (code) => { if (current === p) current = null; resolve({ code, out: out.slice(-200_000) }); });
});
export function cancelAndroid() { if (current) killTree(current); }

/** com.<you>.<app> — a valid Android application id from a name. */
export const appIdFor = (name: string) => `com.vrun.${siteName(name).replace(/-/g, "").replace(/^(\d)/, "app$1").slice(0, 30) || "app"}`;

export interface AndroidResult { prepared: boolean; apk: string | null; appId: string; webDir: string }

/**
 * Make (or update) the Android app. `build: false` only prepares the android/ project (works without
 * Java / the SDK — it can then be opened in Android Studio); `build: true` also produces the APK.
 */
export async function buildAndroid(opts: { name: string; appId?: string; build: boolean }, log: Log, exec: Exec = run): Promise<AndroidResult> {
  const root = getRoot();
  if (!root) throw new Error("Open a folder first.");
  const plan = planPublish(root);
  if (plan.problem) throw new Error(plan.problem);
  const appId = opts.appId?.trim() || appIdFor(opts.name);
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(appId)) throw new Error(`"${appId}" isn't a valid Android app id (like com.yourname.tracker).`);
  const ok = (r: { code: number | null }, what: string) => { if (r.code !== 0) throw new Error(`${what} failed — see the log.`); };
  // 1. the site, built if needed; the app gets its own copy (with the native bridge added)
  if (plan.build) {
    if (!fs.existsSync(path.join(root, "node_modules")) && fs.existsSync(path.join(root, "package.json"))) ok(await exec("npm install", root, log), "npm install");
    ok(await exec(plan.build, root, log), "The build");
  }
  const webRel = ".v-run/android-www";
  const webDir = path.join(root, webRel);
  const source = plan.dir && plan.dir !== "." ? path.join(root, plan.dir) : null;
  if (source) { fs.rmSync(webDir, { recursive: true, force: true }); fs.cpSync(source, webDir, { recursive: true }); }
  else stageSite(root, webDir);
  addNativeBridge(webDir);
  // 2. Capacitor
  if (!fs.existsSync(path.join(root, "package.json"))) ok(await exec("npm init -y", root, log), "npm init");
  if (!fs.existsSync(path.join(root, "node_modules", "@capacitor", "android"))) {
    ok(await exec(`npm install @capacitor/core@${CAP} @capacitor/android@${CAP}`, root, log), "Installing Capacitor");
    ok(await exec(`npm install -D @capacitor/cli@${CAP}`, root, log), "Installing the Capacitor CLI");
  }
  const config = ["capacitor.config.json", "capacitor.config.ts", "capacitor.config.js"].find((f) => fs.existsSync(path.join(root, f)));
  if (!config) ok(await exec(`npx cap init "${opts.name.replace(/"/g, "")}" ${appId} --web-dir ${webRel}`, root, log), "Setting up Capacitor");
  else if (config === "capacitor.config.json") {
    const c = JSON.parse(fs.readFileSync(path.join(root, config), "utf8"));
    if (c.webDir !== webRel) { c.webDir = webRel; fs.writeFileSync(path.join(root, config), `${JSON.stringify(c, null, 2)}\n`); }
  }
  if (!fs.existsSync(path.join(root, "android"))) ok(await exec("npx cap add android", root, log), "Adding Android");
  const plugin = installWifiPlugin(root);
  log(`Wi-Fi scanning added (${plugin.mainActivity}, permissions in AndroidManifest.xml).`);
  ok(await exec("npx cap sync android", root, log), "Syncing the app");
  if (!opts.build) return { prepared: true, apk: null, appId, webDir: webRel };
  // 3. the APK
  const check = await checkAndroid();
  if (check.problems.length) throw new Error(check.problems.join("\n"));
  const env = { JAVA_HOME: check.java!.home, ANDROID_HOME: check.sdk!, ANDROID_SDK_ROOT: check.sdk! };
  ok(await exec(win ? ".\\gradlew.bat assembleDebug" : "./gradlew assembleDebug", path.join(root, "android"), log, env), "The Android build");
  const apk = path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if (!fs.existsSync(apk)) throw new Error("The build finished but there's no APK at android/app/build/outputs/apk/debug — see the log.");
  log(`APK: ${apk}`);
  return { prepared: true, apk, appId, webDir: webRel };
}

/** Install the APK on a phone connected by USB (USB debugging on). */
export async function installApk(apk: string, log: Log, exec: Exec = run) {
  const check = await checkAndroid();
  if (!check.adb) throw new Error("adb (Android platform-tools) isn't installed — it comes with Android Studio.");
  const adb = win ? `& "${check.adb}"` : `"${check.adb}"`; // PowerShell needs & to run a quoted path
  const devices = await exec(`${adb} devices`, path.dirname(apk), log);
  if (!/\tdevice\b/.test(devices.out)) throw new Error("No phone found. Connect it by USB, turn on USB debugging (Settings → Developer options), allow this computer, then try again.");
  const r = await exec(`${adb} install -r "${apk}"`, path.dirname(apk), log);
  if (r.code !== 0 || !/Success/.test(r.out)) throw new Error("Installing failed — see the log.");
  return true;
}
