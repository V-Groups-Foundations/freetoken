// Turns picked files into either an image part (sent to a vision model) or extracted
// text (works with every model). Runs entirely in the browser.

export type Attachment =
  | { id: string; kind: 'image'; name: string; size: number; dataUrl: string }
  | { id: string; kind: 'doc'; name: string; size: number; text: string };

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_DOC_BYTES = 512 * 1024; // 512 KB of text per document
export const MAX_ATTACHMENTS = 6;

const DOC_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'xml', 'yaml', 'yml', 'ini', 'toml', 'rtf',
  'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php',
  'swift', 'kt', 'sh', 'bash', 'sql', 'html', 'css', 'scss', 'vue', 'svelte',
]);

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsText(file);
  });
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });
}

// pdf.js is loaded from the CDN only when a PDF is actually attached (no bundled dependency).
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfjsPromise: Promise<unknown> | null = null;
function loadPdfjs(): Promise<unknown> {
  const w = window as unknown as { pdfjsLib?: unknown };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${PDFJS}/pdf.min.js`;
      s.onload = () => {
        const lib = (window as unknown as { pdfjsLib?: { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib;
        if (lib) lib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
        resolve(lib);
      };
      s.onerror = () => reject(new Error('Could not load the PDF reader.'));
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

async function readPdf(file: File): Promise<string> {
  const lib = (await loadPdfjs()) as {
    getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
  };
  const data = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data }).promise;
  let out = '';
  const pages = Math.min(pdf.numPages, 50);
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  return out.trim();
}

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>;
};

export async function readAttachment(file: File): Promise<Attachment> {
  const id = crypto.randomUUID();
  const e = ext(file.name);

  if (file.type.startsWith('image/')) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name} is too large (max 4 MB).`);
    return { id, kind: 'image', name: file.name, size: file.size, dataUrl: await readDataUrl(file) };
  }

  if (file.type === 'application/pdf' || e === 'pdf') {
    if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name} is too large (max 20 MB).`);
    const text = await readPdf(file);
    if (!text) throw new Error(`No text found in ${file.name} (it may be a scanned image).`);
    return { id, kind: 'doc', name: file.name, size: file.size, text };
  }

  if (file.type.startsWith('text/') || file.type === 'application/json' || DOC_EXTS.has(e)) {
    if (file.size > MAX_DOC_BYTES) throw new Error(`${file.name} is too large (max 2 MB).`);
    return { id, kind: 'doc', name: file.name, size: file.size, text: await readText(file) };
  }

  throw new Error(`${file.name}: only images, PDFs, and text files are supported.`);
}

type Part =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/** Build the message content: a plain string when there are no images, a multimodal array when there are. */
export function buildContent(text: string, attachments: Attachment[]): string | Part[] {
  const docs = attachments.filter((a): a is Extract<Attachment, { kind: 'doc' }> => a.kind === 'doc');
  const images = attachments.filter((a): a is Extract<Attachment, { kind: 'image' }> => a.kind === 'image');

  let combined = text.trim();
  for (const d of docs) {
    combined += `\n\n--- Document: ${d.name} ---\n${d.text}\n--- end of ${d.name} ---`;
  }
  combined = combined.trim();

  if (images.length === 0) return combined;

  const parts: Part[] = [];
  if (combined) parts.push({ type: 'text', text: combined });
  for (const img of images) parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  return parts;
}
