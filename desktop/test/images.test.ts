// generate_image: asks FreeToken's /v1/images/generations, names the file after the real format.
import * as images from "../src/main/images";

let failures = 0;
async function check(name: string, fn: () => Promise<boolean | string>) {
  try { const r = await fn(); if (r === true) console.log(`PASS  ${name}`); else { failures++; console.log(`FAIL  ${name}\n      ${r}`); } }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${(e as Error).stack}`); }
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

(async () => {
  await check("the file extension follows the bytes", async () => {
    const got = [images.imageExt(JPEG), images.imageExt(PNG), images.fitPath("public/hero.png", ".jpg"), images.fitPath("public/hero.JPEG", ".jpg"), images.fitPath("img/logo", ".png"), images.fitPath("a/b.webp", ".webp")];
    const want = [".jpg", ".png", "public/hero.jpg", "public/hero.JPEG", "img/logo.png", "a/b.webp"];
    return JSON.stringify(got) === JSON.stringify(want) || JSON.stringify(got);
  });

  await check("asks FreeToken with the token, prompt and size, and returns the bytes", async () => {
    images.configureImages({ url: () => "http://localhost:3000/api/v1/", token: () => "ft_x" });
    let seen: { url: string; auth: string | null; body: Record<string, unknown> } | null = null;
    const fake = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) };
      return Response.json({ created: 1, data: [{ b64_json: JPEG.toString("base64") }] });
    }) as unknown as typeof fetch;
    const b = await images.generateImage("a fox app icon", { width: 1600, height: 900 }, fake);
    const s = seen as unknown as { url: string; auth: string | null; body: Record<string, unknown> };
    return (b.equals(JPEG) && s.url === "http://localhost:3000/api/v1/images/generations" && s.auth === "Bearer ft_x" && s.body.prompt === "a fox app icon" && s.body.size === "1600x900") || JSON.stringify(s);
  });

  await check("explains a missing token, an old FreeToken and FreeToken's own errors", async () => {
    const msg = async (token: string, res: () => Response) => {
      images.configureImages({ token: () => token });
      try { await images.generateImage("p", undefined, (async () => res()) as unknown as typeof fetch); return "no error"; } catch (e) { return (e as Error).message; }
    };
    const a = await msg("", () => Response.json({}));
    const b = await msg("ft_x", () => new Response("Not Found", { status: 404 }));
    const c = await msg("ft_x", () => Response.json({ error: { message: "Cloudflare's safety filter blocked this result." } }, { status: 422 }));
    return (/API token/.test(a) && /update it/.test(b) && /safety filter/.test(c)) || [a, b, c].join(" | ");
  });

  console.log(failures ? `\n${failures} failed` : "\nall image checks passed");
  process.exit(failures ? 1 : 0);
})();
