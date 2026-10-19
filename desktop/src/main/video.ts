// Export an HTML "video" (see the html-video skill) to a real video file. The page is loaded in a hidden
// offscreen window with a virtual clock (preload/video-clock.ts): performance.now, Date, timers, requestAnimationFrame and every
// CSS/Web animation follow a time we step frame by frame, so the output is smooth and exact however
// slow rendering is. Frames are encoded in the renderer (WebCodecs → MP4, or WebM if H.264 is missing).
import { BrowserWindow, type NativeImage } from "electron";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface EncoderHost {
  begin(cfg: { width: number; height: number; fps: number }): Promise<{ ext: "mp4" | "webm" }>;
  frame(bgra: Uint8Array): Promise<void>;
  end(): Promise<Uint8Array>;
  abort(): void;
}
let encoder: EncoderHost | null = null;
export const setEncoderHost = (h: EncoderHost | null) => { encoder = h; };

export interface ExportOptions { fps?: number; width?: number; height?: number; duration?: number; out?: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void }

const nextPaint = (win: BrowserWindow) => new Promise<NativeImage>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("The page stopped painting.")), 15_000);
  win.webContents.once("paint", (_e, _dirty, image) => { clearTimeout(timer); resolve(image); });
  win.webContents.invalidate();
});

/** Render `target` (an .html file path or a URL) to a video file; returns where it was written. */
const dbgLog = (...a: unknown[]) => { if (process.env.VRUN_VIDEO_DEBUG) console.log("[video]", ...a); };

export async function exportVideo(target: string, opts: ExportOptions = {}) {
  dbgLog("start", target);
  if (!encoder) throw new Error("Video export needs the V-Run window to be open.");
  const fps = Math.min(60, Math.max(1, Math.round(opts.fps ?? 30)));
  const width = Math.min(3840, Math.max(64, Math.round((opts.width ?? 1920) / 2) * 2));
  const height = Math.min(2160, Math.max(64, Math.round((opts.height ?? 1080) / 2) * 2));
  const isUrl = /^(https?|file):\/\//i.test(target);
  const url = isUrl ? target : pathToFileURL(target).href;

  const win = new BrowserWindow({
    show: false, width, height, useContentSize: true, frame: false, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, preload: path.join(__dirname, "../preload/video-clock.js"), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const errors: string[] = [];
  win.webContents.on("console-message", (e: any) => { const lvl = e.level ?? e.params?.level; if (lvl === "error" || lvl === 3) errors.push(String(e.message ?? e.params?.message).slice(0, 300)); });
  try {
    win.webContents.setFrameRate(60);
    win.setContentSize(width, height);
    dbgLog("loading", url);
    await win.loadURL(url);
    dbgLog("loaded");
    await win.webContents.executeJavaScript("document.fonts ? document.fonts.ready.then(() => true) : true");
    await new Promise((r) => setTimeout(r, 300)); // late images and layout
    const ok = await win.webContents.executeJavaScript("!!window.__vrunClock");
    if (!ok) throw new Error("Couldn't take control of the page's clock.");
    await win.webContents.executeJavaScript("window.__vrunClock.advance(0)");
    let duration = opts.duration ?? (await win.webContents.executeJavaScript("window.__vrunClock.duration()"));
    if (!(duration > 0)) duration = 10;
    duration = Math.min(180, duration);
    const total = Math.max(1, Math.round(duration * fps));

    dbgLog("duration", duration, "frames", total);
    const { ext } = await encoder.begin({ width, height, fps });
    dbgLog("encoder ready", ext);
    for (let i = 0; i < total; i++) {
      if (opts.signal?.aborted) throw new Error("Stopped.");
      await win.webContents.executeJavaScript(`window.__vrunClock.advance(${(i / fps).toFixed(6)})`);
      let img = await nextPaint(win);
      if (i < 2) dbgLog("frame", i, img.getSize(), img.toBitmap().length);
      const s = img.getSize();
      if (s.width !== width || s.height !== height) img = img.resize({ width, height, quality: "best" });
      await encoder.frame(img.toBitmap());
      if (i < 2) dbgLog("encoded", i);
      opts.onProgress?.(i + 1, total);
    }
    const data = await encoder.end();
    const base = isUrl ? path.resolve("video") : target.replace(/\.html?$/i, "");
    const out = opts.out ? opts.out.replace(/\.(mp4|webm)$/i, "") + `.${ext}` : `${base}.${ext}`;
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, data);
    return { file: out, bytes: data.length, frames: total, duration: total / fps, fps, width, height, ext, errors: errors.slice(0, 5) };
  } catch (e) {
    encoder.abort();
    throw e;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}
