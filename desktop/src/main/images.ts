// Pictures for the apps V-Run builds (icons, hero images, product photos…) from FreeToken's
// /v1/images/generations — free FLUX on the user's Cloudflare account, else Pollinations.

let cfg = { url: () => "http://localhost:3000/api/v1", token: () => "" };
export const configureImages = (c: Partial<typeof cfg>) => { cfg = { ...cfg, ...c }; };

/** The format the bytes are actually in, so the file gets the right extension. */
export function imageExt(b: Uint8Array): ".png" | ".jpg" | ".webp" {
  if (b[0] === 0x89 && b[1] === 0x50) return ".png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return ".webp";
  return ".jpg";
}

/** `assets/hero.png` holding JPEG bytes → `assets/hero.jpg`; a path without an image extension gets one. */
export function fitPath(rel: string, ext: string): string {
  const m = /\.(png|jpe?g|webp)$/i.exec(rel);
  if (!m) return rel + ext;
  return `.${m[1].toLowerCase().replace("jpeg", "jpg")}` === ext ? rel : rel.slice(0, -m[0].length) + ext;
}

export async function generateImage(prompt: string, size?: { width: number; height: number }, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<Buffer> {
  const token = cfg.token();
  if (!token) throw new Error("Making images needs FreeToken: add your FreeToken API token (ft_…) in Settings.");
  const res = await fetchImpl(`${cfg.url().replace(/\/+$/, "")}/images/generations`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt, n: 1, ...(size ? { size: `${size.width}x${size.height}` } : {}) }),
    signal,
  });
  const j = (await res.json().catch(() => null)) as { data?: { b64_json?: string }[]; error?: { message?: string } } | null;
  if (res.status === 404) throw new Error("This FreeToken doesn't make images yet — update it (git pull in the free_token folder) and restart it.");
  if (!res.ok || !j?.data?.[0]?.b64_json) throw new Error(j?.error?.message ?? `FreeToken couldn't make the image (HTTP ${res.status}).`);
  return Buffer.from(j.data[0].b64_json, "base64");
}
