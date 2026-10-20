// Files and images the user pastes (Ctrl+V) or drops into the chat. Each is saved into the project at
// .v-run/uploads/ so the agent can use it (put a logo on the site, read a CSV, open the PDF with a
// script). Images also go to the model as images; text files have their contents included.
import fsp from "node:fs/promises";
import path from "node:path";
import { getRoot } from "./workspace";

export interface Attachment { name: string; mime?: string; /** base64 (pasted data) */ data?: string; /** absolute path (dropped files) */ path?: string }
export interface Prepared { images: { mime: string; data: string }[]; texts: string[]; note: string }

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // what model APIs accept per image
const MAX_TEXT_CHARS = 40_000;
const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|env\.example|xml|html?|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sql|sh|ps1|bat|log|svg)$/i;

const safeName = (n: string) => (n.replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^\.+/, "").slice(-120) || "file");

/** Save the attachments into the project and turn them into model input. */
export async function prepareAttachments(list: Attachment[] = []): Promise<Prepared> {
  const out: Prepared = { images: [], texts: [], note: "" };
  if (!list.length) return out;
  const root = getRoot();
  if (!root) throw new Error("Open a folder first — attachments are saved into the project.");
  const dir = path.join(root, ".v-run", "uploads");
  await fsp.mkdir(dir, { recursive: true });
  const lines: string[] = [];
  for (const a of list.slice(0, 20)) {
    let buf: Buffer;
    if (a.data) buf = Buffer.from(a.data, "base64");
    else if (a.path) {
      const st = await fsp.stat(a.path).catch(() => null);
      if (!st?.isFile()) { lines.push(`- ${a.name}: couldn't be read (a folder, or it no longer exists)`); continue; }
      if (st.size > MAX_BYTES) { lines.push(`- ${a.name}: not attached — over 20 MB`); continue; }
      buf = await fsp.readFile(a.path);
    } else continue;
    const ext = path.extname(a.name).toLowerCase();
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const file = path.join(dir, `${stamp}-${safeName(a.name)}`);
    await fsp.writeFile(file, buf);
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const mime = a.mime && a.mime !== "application/octet-stream" ? a.mime : IMAGE_MIME[ext] ?? "";
    if (IMAGE_MIME[ext] || /^image\/(png|jpe?g|gif|webp)$/.test(mime)) {
      if (buf.length <= MAX_IMAGE_BYTES) out.images.push({ mime: mime || "image/png", data: buf.toString("base64") });
      lines.push(`- ${rel} — image (${(buf.length / 1024).toFixed(0)} KB)${buf.length > MAX_IMAGE_BYTES ? ", too large to show you; use the file" : ", shown to you above"}`);
    } else if (TEXT_EXT.test(a.name) || /^text\//.test(mime) || /json|xml|javascript/.test(mime)) {
      const text = buf.toString("utf8");
      out.texts.push(`Attached file ${rel}:\n\`\`\`\n${text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…(truncated — read the rest with read_file)` : text}\n\`\`\``);
      lines.push(`- ${rel} — text, contents included`);
    } else {
      lines.push(`- ${rel} — ${ext.slice(1) || "binary"} file (${(buf.length / 1024).toFixed(0)} KB); not shown — work with it from the project (e.g. a script)`);
    }
  }
  out.note = `The user attached ${lines.length} file${lines.length > 1 ? "s" : ""}, saved in the project:\n${lines.join("\n")}`;
  return out;
}
