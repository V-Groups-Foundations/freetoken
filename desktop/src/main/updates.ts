// Auto-update for the installed app (GitHub Releases, through electron-updater): checks on start and every
// few hours, downloads in the background, and installs when V-Run quits — or at once if the user says so.
// Does nothing when running from source (npm start) or in tests.
import type { App } from "electron";

type Status = { state: "idle" | "checking" | "downloading" | "ready" | "error" | "off"; version?: string; percent?: number; error?: string };
let status: Status = { state: "off" };
let updater: typeof import("electron-updater").autoUpdater | null = null;

export const updateStatus = () => status;

export async function startUpdates(app: App, onChange: (s: Status) => void) {
  if (!app.isPackaged || process.env.VRUN_NO_UPDATES) return;
  const set = (s: Status) => { status = s; onChange(s); };
  try {
    ({ autoUpdater: updater } = await import("electron-updater"));
  } catch (e) { set({ state: "error", error: `Updates unavailable: ${(e as Error).message}` }); return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("checking-for-update", () => set({ state: "checking" }));
  updater.on("update-not-available", () => set({ state: "idle" }));
  updater.on("download-progress", (p) => set({ state: "downloading", percent: Math.round(p.percent) }));
  updater.on("update-downloaded", (info) => set({ state: "ready", version: info.version }));
  // offline, or no release published yet: not the user's problem — try again later
  updater.on("error", (e) => set({ state: "error", error: e?.message ?? String(e) }));
  const check = () => updater?.checkForUpdates().catch(() => {});
  set({ state: "idle" });
  setTimeout(check, 10_000);
  setInterval(check, 4 * 60 * 60 * 1000).unref();
}

/** Restart into the downloaded version now. */
export function installNow() {
  if (status.state !== "ready" || !updater) return false;
  setImmediate(() => updater!.quitAndInstall());
  return true;
}
