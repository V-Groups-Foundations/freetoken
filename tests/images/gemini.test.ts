import { describe, it, expect } from 'vitest';
import { generateImageGemini } from '@/images/gemini';
import type { FetchFn } from '@/providers/client';

const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as unknown as FetchFn;

describe('generateImageGemini', () => {
  it('extracts inline image data into a data URL', async () => {
    const body = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] };
    const r = await generateImageGemini({ prompt: 'a cat' }, 'k', { fetchImpl: mock(() => new Response(JSON.stringify(body), { status: 200 })) });
    expect(r).toEqual({ ok: true, dataUrl: 'data:image/png;base64,AAAA' });
  });

  it('reports a rejected key', async () => {
    const r = await generateImageGemini({ prompt: 'x' }, 'bad', { fetchImpl: mock(() => new Response('no', { status: 403 })) });
    expect(r).toMatchObject({ ok: false, status: 403, message: 'Gemini rejected your key.' });
  });

  it('explains a rate-limit (429) clearly', async () => {
    const r = await generateImageGemini({ prompt: 'x' }, 'k', { fetchImpl: mock(() => new Response('no', { status: 429 })) });
    expect(r).toMatchObject({ ok: false, status: 429 });
    if (!r.ok) expect(r.message).toMatch(/rate-limited/i);
  });

  it('fails cleanly when no image part is returned', async () => {
    const r = await generateImageGemini({ prompt: 'x' }, 'k', { fetchImpl: mock(() => new Response(JSON.stringify({ candidates: [] }), { status: 200 })) });
    expect(r).toMatchObject({ ok: false, status: 502 });
  });
});
