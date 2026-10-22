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
/** Where to get Android Studio by hand when V-Run can't install it. */
export const STUDIO_URL = "https://developer.android.com/studio";
// Capacitor 8's Android project builds with Gradle 8.14, which runs on Java 21–24 — not on the Java 25
// that new Android Studio versions bundle ("Unsupported class file major version 69")
const JAVA_MIN = 21, JAVA_MAX = 24;
/** V-Run's own tools (a private JDK 21 when no usable Java is installed). */
export const toolsDir = () => path.join(os.homedir(), ".vrun", "tools");
const jdkDist = () => path.join(toolsDir(), "jdk-21");
/** The private JDK's home (on a Mac the JDK sits inside Contents/Home). */
const privateJdk = () => (fs.existsSync(path.join(jdkDist(), "Contents", "Home")) ? path.join(jdkDist(), "Contents", "Home") : jdkDist());
const javaFits = (v: number) => v >= JAVA_MIN && v <= JAVA_MAX;

// ---------------------------------------------------------------- what's installed

function javaVersion(java: string): Promise<number | null> {
  return new Promise((resolve) => execFile(java, ["-version"], { windowsHide: true, timeout: 15_000 }, (e, out, err) => {
    const m = /version "(\d+)(?:\.(\d+))?/.exec(`${out}${err}`);
    resolve(e && !m ? null : m ? (m[1] === "1" ? Number(m[2]) : Number(m[1])) : null);
  }));
}

/** JDK candidates: V-Run's own JDK 21, JAVA_HOME, Android Studio's bundled one, then PATH. */
function javaCandidates() {
  const exe = win ? "java.exe" : "java";
  const homes = [privateJdk(), process.env.JAVA_HOME,
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

/** Android Studio itself (its launcher), if installed. */
export function findStudio(): string | null {
  const c = win ? [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Android", "Android Studio", "bin", "studio64.exe"), path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Android Studio", "bin", "studio64.exe")]
    : process.platform === "darwin" ? ["/Applications/Android Studio.app", path.join(os.homedir(), "Applications", "Android Studio.app")]
      : ["/opt/android-studio/bin/studio.sh", path.join(os.homedir(), "android-studio", "bin", "studio.sh"), "/snap/bin/android-studio"];
  return c.find((p) => fs.existsSync(p)) ?? null;
}

/** A package manager V-Run can install Android Studio with: winget (Windows) or Homebrew (Mac). */
async function findInstaller(): Promise<"winget" | "brew" | null> {
  const has = (cmd: string, args: string[]) => new Promise<boolean>((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 20_000 }, (e) => resolve(!e)));
  if (win) return (await has("winget", ["--version"])) ? "winget" : null;
  if (process.platform === "darwin") return (await has("brew", ["--version"])) ? "brew" : null;
  return null; // Linux: the snap / tarball needs sudo or a desktop install — the download page explains it
}

export interface AndroidCheck {
  java: { home: string; version: number } | null;
  sdk: string | null;
  adb: string | null;
  /** Android Studio's launcher, if installed */
  studio: string | null;
  /** how V-Run can install Android Studio here, if it can */
  installer: "winget" | "brew" | null;
  /** what "Set up" would do: install Android Studio, get Java 21, open Android Studio to finish its setup */
  missing: { studio: boolean; java: boolean; sdk: boolean };
  problems: string[];
}

export async function checkAndroid(): Promise<AndroidCheck> {
  // the first Java the build tools can run on; else the first one found (to say why it can't be used)
  let java: AndroidCheck["java"] = null;
  for (const c of javaCandidates()) {
    const v = await javaVersion(c.java);
    if (v && javaFits(v)) { java = { home: c.home, version: v }; break; }
    if (v && !java) java = { home: c.home, version: v };
  }
  const sdk = findSdk();
  const studio = findStudio();
  const installer = studio || sdk ? null : await findInstaller();
  const adbPath = sdk ? path.join(sdk, "platform-tools", win ? "adb.exe" : "adb") : null;
  const missing = { studio: !studio && !sdk, java: !java || !javaFits(java.version), sdk: !sdk };
  const problems: string[] = [];
  const setup = "Press Set up and V-Run gets what's missing (it asks first)";
  if (missing.studio) problems.push(`Android Studio isn't installed (it brings the Android SDK). ${installer ? `${setup}, or download it from ${STUDIO_URL}.` : `Download it from ${STUDIO_URL}, install it and open it once, then check again.`}`);
  else if (missing.sdk) problems.push("The Android SDK isn't set up yet: open Android Studio once and let its setup finish (it downloads the SDK), then check again.");
  if (!java) problems.push(`Java (JDK 21) isn't installed. ${setup}.`);
  else if (java.version < JAVA_MIN) problems.push(`Java ${java.version} is too old — Android builds need Java 21. ${setup}.`);
  else if (java.version > JAVA_MAX) problems.push(`Java ${java.version} (the one Android Studio comes with) is too new for Android's build tools, which run on Java 21–24. ${setup} — it adds Java 21 just for V-Run.`);
  return { java: java && javaFits(java.version) ? java : java, sdk, adb: adbPath && fs.existsSync(adbPath) ? adbPath : null, studio, installer, missing, problems };
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

// ---------------------------------------------------------------- getting the tools (the user agreed first)

/** The official Eclipse Temurin JDK 21 for this computer, from Adoptium. */
export function jdkUrl(platform = process.platform, arch = process.arch) {
  const o = platform === "win32" ? "windows" : platform === "darwin" ? "mac" : "linux";
  return `https://api.adoptium.net/v3/binary/latest/21/ga/${o}/${arch === "arm64" ? "aarch64" : "x64"}/jdk/hotspot/normal/eclipse`;
}

/** Download a JDK 21 into V-Run's tools folder (no admin rights needed; nothing else on the computer changes). */
export async function getJdk21(log: Log, fetchImpl: typeof fetch = fetch): Promise<string> {
  const dir = toolsDir();
  fs.mkdirSync(dir, { recursive: true });
  const archive = path.join(dir, win ? "jdk-21-download.zip" : "jdk-21-download.tar.gz");
  log("Downloading Java 21 (Eclipse Temurin, about 190 MB)…");
  const res = await fetchImpl(jdkUrl());
  if (!res.ok || !res.body) throw new Error(`Couldn't download Java 21 (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  const out = fs.createWriteStream(archive);
  let got = 0, shown = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
    const pct = total ? Math.floor((got / total) * 10) * 10 : 0;
    if (pct > shown) { shown = pct; log(`  ${pct}%`); }
  }
  await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  // unpack beside it, then keep the one JDK folder as tools/jdk-21
  const unpack = path.join(dir, "jdk-21-unpack");
  fs.rmSync(unpack, { recursive: true, force: true });
  fs.mkdirSync(unpack);
  // Windows' own tar (bsdtar) reads zip files; a Git-for-Windows tar earlier on PATH can't
  const tar = win ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  const err = await new Promise<string | null>((resolve) => execFile(tar, ["-xf", archive, "-C", unpack], { windowsHide: true, maxBuffer: 16 << 20 }, (e, _o, se) => resolve(e ? `${e.message} ${se}`.trim() : null)));
  if (err) throw new Error(`Couldn't unpack Java 21: ${err.slice(0, 300)}`);
  const top = fs.readdirSync(unpack).map((n) => path.join(unpack, n)).find((p) => fs.statSync(p).isDirectory());
  const home = top && (fs.existsSync(path.join(top, "Contents", "Home")) ? path.join(top, "Contents", "Home") : top);
  if (!home || !fs.existsSync(path.join(home, "bin", win ? "java.exe" : "java"))) throw new Error("The Java 21 download didn't contain a JDK.");
  fs.rmSync(jdkDist(), { recursive: true, force: true });
  fs.renameSync(top!, jdkDist());
  fs.rmSync(unpack, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  log(`Java 21 is ready (${privateJdk()}).`);
  return privateJdk();
}

/** Open Android Studio (its first run downloads the Android SDK). */
export function openStudio(studio: string) {
  const p = process.platform === "darwin" ? spawn("open", ["-a", studio], { detached: true, stdio: "ignore" })
    : spawn(studio, [], { detached: true, stdio: "ignore", windowsHide: false });
  p.on("error", () => {});
  p.unref();
}

/**
 * Get what building an Android app needs — the user has agreed: Android Studio (with winget / Homebrew;
 * without one, the error gives the download link), Java 21 when there's no usable Java, and Android
 * Studio opened when its SDK isn't set up yet. Returns the check afterwards.
 */
export async function setupAndroid(log: Log, deps: { exec?: Exec; fetchImpl?: typeof fetch; check?: () => Promise<AndroidCheck>; open?: (studio: string) => void } = {}): Promise<AndroidCheck> {
  const check = deps.check ?? checkAndroid;
  let c = await check();
  if (c.missing.studio) {
    if (!c.installer) throw new Error(`V-Run can't install Android Studio on this computer by itself. Download it from ${STUDIO_URL}, install it, open it once, then check again.`);
    const cmd = c.installer === "winget"
      ? "winget install --id Google.AndroidStudio --exact --silent --accept-package-agreements --accept-source-agreements"
      : "brew install --cask android-studio";
    log(`Installing Android Studio (about 1.5 GB) with ${c.installer}…`);
    const r = await (deps.exec ?? run)(cmd, os.homedir(), log);
    if (r.code !== 0) throw new Error(`Installing Android Studio didn't work (see the log). Download it from ${STUDIO_URL} instead, install it, then check again.`);
    c = await check();
  }
  if (c.missing.java) { await getJdk21(log, deps.fetchImpl); c = await check(); }
  if (c.missing.sdk && c.studio) {
    (deps.open ?? openStudio)(c.studio);
    log("Android Studio is open: click through its setup (it downloads the Android SDK), then check again.");
  }
  return c;
}

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
