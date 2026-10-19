// Preload for video export's capture window: before the page's own scripts run, replace time with a
// clock that export steps frame by frame (performance.now, Date, timers, requestAnimationFrame, and every
// CSS/Web animation), so the video is exact however slowly frames render.
import { contextBridge } from "electron";

/** Runs in the page's world (serialized by executeInMainWorld), so it must be self-contained. */
function installVirtualClock() {
  const w = window as any;
  if (w.__vrunClock) return;
  let now = 0;
  const RealDate = Date;
  const epoch = RealDate.now();
  const timers = new Map<number, { at: number; fn: any; args: any[]; every: number }>();
  const frames = new Map<number, FrameRequestCallback>();
  const born = new WeakMap<Animation, number>();
  let seq = 1;
  // the real frame clock, kept to know when the new state has actually been drawn
  const realFrame = window.requestAnimationFrame.bind(window);
  const painted = () => new Promise<void>((r) => realFrame(() => realFrame(() => r())));
  performance.now = () => now;
  class VDate extends RealDate {
    constructor(...a: any[]) { if (a.length) super(...(a as [])); else super(epoch + now); }
    static now() { return epoch + now; }
  }
  w.Date = VDate;
  w.setTimeout = (fn: any, ms = 0, ...args: any[]) => { const id = seq++; timers.set(id, { at: now + Math.max(0, +ms || 0), fn, args, every: 0 }); return id; };
  w.setInterval = (fn: any, ms = 0, ...args: any[]) => { const id = seq++; const every = Math.max(1, +ms || 0); timers.set(id, { at: now + every, fn, args, every }); return id; };
  w.clearTimeout = w.clearInterval = (id: number) => { timers.delete(id); };
  w.requestAnimationFrame = (cb: FrameRequestCallback) => { const id = seq++; frames.set(id, cb); return id; };
  w.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  // a real (macro) task, so promise chains started by timers settle before the next one fires
  const tick = () => new Promise<void>((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const syncAnimations = () => {
    for (const a of document.getAnimations()) {
      if (!born.has(a)) born.set(a, now); // a CSS animation starts when its element appears
      try { a.pause(); a.currentTime = Math.max(0, now - born.get(a)!); } catch { /* finished/removed */ }
    }
  };
  w.__vrunClock = {
    async advance(t: number) {
      const target = t * 1000;
      for (let guard = 0; guard < 20000; guard++) {
        let next: [number, { at: number; fn: any; args: any[]; every: number }] | null = null;
        for (const e of timers) if (e[1].at <= target && (!next || e[1].at < next[1].at)) next = e;
        if (!next) break;
        const [id, tm] = next;
        now = Math.max(now, tm.at);
        if (tm.every) tm.at += tm.every; else timers.delete(id);
        try { if (typeof tm.fn === "function") tm.fn(...tm.args); } catch (e) { console.error(e); }
        await tick();
      }
      now = target;
      const cbs = [...frames.values()];
      frames.clear();
      for (const cb of cbs) { try { cb(now); } catch (e) { console.error(e); } }
      const v = w.__video;
      try {
        if (v && typeof v.render === "function") await v.render(t);
        else if (v && typeof v.seek === "function") await v.seek(t);
      } catch (e) { console.error(e); }
      await tick();
      syncAnimations();
      for (const m of document.querySelectorAll("video,audio")) { try { (m as HTMLMediaElement).pause(); (m as HTMLMediaElement).currentTime = t; } catch { /* not seekable */ } }
      await painted();
    },
    duration() {
      const v = w.__video;
      if (v && +v.duration > 0) return +v.duration;
      let end = 0;
      for (const a of document.getAnimations()) {
        const e = Number(a.effect?.getComputedTiming().endTime);
        if (isFinite(e) && e > end) end = e;
      }
      return end > 0 ? end / 1000 + 0.5 : 0;
    },
  };
}

contextBridge.executeInMainWorld({ func: installVirtualClock });
