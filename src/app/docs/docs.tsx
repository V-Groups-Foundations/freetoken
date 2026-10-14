'use client';

import { useRef, useState } from 'react';
import { readAttachment } from '../chat/attachments';
import { PageHeader } from '../page-header';
import { toast } from '../fx';

interface Doc {
  id: string;
  name: string;
  chunkCount: number;
}

interface Source {
  n: number;
  documentName: string;
  excerpt: string;
  score: number;
}

export function DocsClient({ initialDocs }: { initialDocs: Doc[] }) {
  const [docs, setDocs] = useState<Doc[]>(initialDocs);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [askError, setAskError] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        let name = file.name;
        let text: string;

        if (file.type.startsWith('image/')) {
          // Image of text → OCR it (needs a connected OCR.space key).
          const fd = new FormData();
          fd.append('file', file, file.name);
          const ocrRes = await fetch('/api/ocr', { method: 'POST', body: fd });
          const ocrData = await ocrRes.json().catch(() => null);
          if (!ocrRes.ok || typeof ocrData?.text !== 'string') {
            setUploadError(ocrData?.error?.message ?? `Could not read text from ${file.name}.`);
            continue;
          }
          text = ocrData.text;
        } else {
          const att = await readAttachment(file);
          if (att.kind !== 'doc') {
            setUploadError(`${file.name}: only text, PDF, and image documents can be indexed.`);
            continue;
          }
          name = att.name;
          text = att.text;
        }

        const res = await fetch('/api/docs', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, text }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.id) {
          setUploadError(data?.error?.message ?? `Could not index ${file.name}.`);
          continue;
        }
        setDocs((prev) => [...prev, { id: data.id, name: data.name, chunkCount: data.chunkCount }]);
        toast(`Indexed ${data.name}`);
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Could not read the file.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/docs/${id}`, { method: 'DELETE' });
    if (res.ok) setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  async function ask() {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    setSources([]);
    try {
      const res = await fetch('/api/docs/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.answer !== 'string') {
        setAskError(data?.error?.message ?? 'Could not answer that.');
        return;
      }
      setAnswer(data.answer);
      setSources(data.sources ?? []);
    } catch {
      setAskError('Could not reach the server.');
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="free · embeddings + ocr"
        title="Chat with your documents"
        subtitle="Upload text, PDFs, or images of text (OCR), then ask questions answered from their contents with citations."
      />

      <div className="card card-pad flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-sm">Your documents</span>
          <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="btn btn-primary btn-sm">
            {uploading ? 'Indexing…' : 'Upload'}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".txt,.md,.markdown,.csv,.tsv,.json,.log,.xml,.yaml,.yml,.pdf,.html,.png,.jpg,.jpeg,.webp,.gif,.bmp,text/*,application/pdf,application/json,image/*"
            className="hidden"
            onChange={(e) => void onFiles(e.target.files)}
          />
        </div>
        {uploadError && <p className="text-sm" style={{ color: 'var(--danger, #ef4444)' }}>{uploadError}</p>}
        {docs.length === 0 ? (
          <p className="muted text-sm">No documents yet. Upload a text file or PDF to get started.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--bg)]">
                <span className="truncate">📄 {d.name} <span className="muted">· {d.chunkCount} chunks</span></span>
                <button type="button" onClick={() => void remove(d.id)} className="muted hover:text-[var(--danger,#ef4444)]" aria-label={`Delete ${d.name}`}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card card-pad flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void ask(); } }}
            placeholder="Ask something about your documents…"
            disabled={docs.length === 0}
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
          />
          <button type="button" onClick={ask} disabled={asking || !question.trim() || docs.length === 0} className="btn btn-primary">
            {asking ? 'Thinking…' : 'Ask'}
          </button>
        </div>
        {askError && <p className="text-sm" style={{ color: 'var(--danger, #ef4444)' }}>{askError}</p>}
        {answer && (
          <div className="flex flex-col gap-3">
            <p className="whitespace-pre-wrap text-sm">{answer}</p>
            {sources.length > 0 && (
              <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-3">
                <span className="muted text-xs font-medium uppercase tracking-wide">Sources</span>
                {sources.map((s) => (
                  <details key={s.n} className="text-sm">
                    <summary className="cursor-pointer">[{s.n}] {s.documentName} <span className="muted">· {(s.score * 100).toFixed(0)}% match</span></summary>
                    <p className="muted mt-1 pl-4 text-xs">{s.excerpt}…</p>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
