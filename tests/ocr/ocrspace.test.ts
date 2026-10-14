import { describe, it, expect } from 'vitest';
import { ocrImage } from '@/ocr/ocrspace';
import type { FetchFn } from '@/providers/client';

const mock = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => fn as unknown as FetchFn;
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

describe('ocrImage', () => {
  it('joins ParsedText from results', async () => {
    const body = { ParsedResults: [{ ParsedText: 'hello ' }, { ParsedText: 'world' }], IsErroredOnProcessing: false };
    const r = await ocrImage('k', blob(), 'a.png', mock(() => new Response(JSON.stringify(body), { status: 200 })));
    expect(r).toEqual({ ok: true, text: 'hello \nworld' });
  });

  it('fails when OCR.space reports an error', async () => {
    const body = { IsErroredOnProcessing: true, ErrorMessage: ['bad'] };
    const r = await ocrImage('k', blob(), 'a.png', mock(() => new Response(JSON.stringify(body), { status: 200 })));
    expect(r).toMatchObject({ ok: false, status: 422 });
  });

  it('fails when no text is found', async () => {
    const body = { ParsedResults: [{ ParsedText: '   ' }], IsErroredOnProcessing: false };
    const r = await ocrImage('k', blob(), 'a.png', mock(() => new Response(JSON.stringify(body), { status: 200 })));
    expect(r).toMatchObject({ ok: false, status: 422 });
  });
});
