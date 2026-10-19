// Encodes the frames video export sends (raw BGRA) into an MP4 (H.264) or, if this machine can't encode
// H.264, a WebM (VP9). Runs in the V-Run window because WebCodecs lives in the browser side.
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";

type Job = {
  encoder: VideoEncoder; finish: () => Uint8Array; fps: number; width: number; height: number;
  index: number; error: Error | null;
};
let job: Job | null = null;

async function supported(codec: string, width: number, height: number, fps: number) {
  try {
    return (await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, bitrate: 1e6 })).supported === true;
  } catch { return false; }
}

export async function begin({ width, height, fps }: { width: number; height: number; fps: number }) {
  if (typeof VideoEncoder === "undefined") throw new Error("This version of V-Run can't encode video.");
  job?.encoder.close();
  job = null;
  const pixels = width * height;
  const bitrate = Math.round(Math.min(40e6, Math.max(4e6, pixels * fps * 0.12)));
  const avc = pixels > 1920 * 1088 ? "avc1.640033" : "avc1.640028"; // High profile, level 5.1 / 4.0
  let ext: "mp4" | "webm";
  let codec: string;
  let add: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
  let finish: () => Uint8Array;
  if (await supported(avc, width, height, fps)) {
    ext = "mp4"; codec = avc;
    const muxer = new Mp4Muxer({ target: new Mp4Target(), video: { codec: "avc", width, height, frameRate: fps }, fastStart: "in-memory" });
    add = (c, m) => muxer.addVideoChunk(c, m);
    finish = () => { muxer.finalize(); return new Uint8Array(muxer.target.buffer); };
  } else if (await supported("vp09.00.40.08", width, height, fps)) {
    ext = "webm"; codec = "vp09.00.40.08";
    const muxer = new WebmMuxer({ target: new WebmTarget(), video: { codec: "V_VP9", width, height, frameRate: fps } });
    add = (c, m) => muxer.addVideoChunk(c, m);
    finish = () => { muxer.finalize(); return new Uint8Array(muxer.target.buffer); };
  } else throw new Error("No video encoder is available on this machine (H.264 or VP9).");

  const j: Job = { encoder: null as unknown as VideoEncoder, finish, fps, width, height, index: 0, error: null };
  j.encoder = new VideoEncoder({ output: (c, m) => add(c, m), error: (e) => { j.error = e instanceof Error ? e : new Error(String(e)); } });
  j.encoder.configure({ codec, width, height, bitrate, framerate: fps, latencyMode: "quality", ...(ext === "mp4" ? { avc: { format: "avc" } } : {}) });
  job = j;
  return { ext };
}

export async function frame(bgra: Uint8Array) {
  const j = job;
  if (!j) throw new Error("No video export in progress.");
  if (j.error) throw j.error;
  const us = 1_000_000 / j.fps;
  const f = new VideoFrame(bgra, { format: "BGRA", codedWidth: j.width, codedHeight: j.height, timestamp: Math.round(j.index * us), duration: Math.round(us) });
  j.encoder.encode(f, { keyFrame: j.index % (j.fps * 2) === 0 });
  f.close();
  j.index++;
  // keep memory flat: don't let the encoder queue run far ahead
  while (j.encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
}

export async function end() {
  const j = job;
  if (!j) throw new Error("No video export in progress.");
  await j.encoder.flush();
  if (j.error) throw j.error;
  j.encoder.close();
  job = null;
  return j.finish();
}

export function abort() {
  try { job?.encoder.close(); } catch { /* already closed */ }
  job = null;
}
