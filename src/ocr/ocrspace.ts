// OCR via OCR.space (BYO free key) — turns an image of text into plain text for Docs.

import type { FetchFn } from '@/providers/client';

export type OcrResult =
  | { ok: true; text: string }
  | { ok: false; status: number; message: string };

export async function ocrImage(
  key: string,
  file: Blob,
  filename: string,
  fetchImpl: FetchFn = fetch,
): Promise<OcrResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const form = new FormData();
    form.append('apikey', key);
    form.append('OCREngine', '2');
    form.append('scale', 'true');
    form.append('file', file, filename);
    const res = await fetchImpl('https://api.ocr.space/parse/image', { method: 'POST', body: form, signal: ctrl.signal });
    if (!res.ok) return { ok: false, status: res.status, message: `OCR.space returned ${res.status}.` };

    const json = (await res.json().catch(() => ({}))) as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string | string[];
      ParsedResults?: { ParsedText?: string }[];
    };
    if (json.IsErroredOnProcessing) {
      const err = Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join(' ') : json.ErrorMessage ?? 'OCR failed.';
      return { ok: false, status: 422, message: err };
    }
    const text = (json.ParsedResults ?? []).map((r) => r.ParsedText ?? '').join('\n').trim();
    if (!text) return { ok: false, status: 422, message: 'No readable text found in the image.' };
    return { ok: true, text };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the OCR service.' };
  } finally {
    clearTimeout(timer);
  }
}
