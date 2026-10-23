import { describe, it, expect } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { sse } from '../helpers/fake-fetch';
import { recordUsage, usageToday, estimateTokens } from '@/usage/ledger';
import { tapSseUsage } from '@/usage/tap';

const drain = async (s: ReadableStream<Uint8Array>) => new Response(s).text();

describe('ledger', () => {
  it('sums today’s successful usage per model', async () => {
    const db = await createTestDb();
    const { id } = await createUser(db);
    const ev = { userId: id, provider: 'groq', modelId: 'm', source: 'api' as const, promptTokens: 10, completionTokens: 5, latencyMs: 1 };
    await recordUsage(db, { ...ev, status: 'ok' });
    await recordUsage(db, { ...ev, status: 'ok' });
    await recordUsage(db, { ...ev, status: 'rate_limited' });
    await recordUsage(db, { ...ev, status: 'error', promptTokens: 0, completionTokens: 0 });
    // the error reached the provider (it counts against a quota); the rate-limit refusal didn't
    expect((await usageToday(db, id)).get('groq/m')).toMatchObject({ requests: 2, attempts: 3, tokens: 30, estimatedTokens: 0 });
  });
  it('estimates tokens', () => {
    expect(estimateTokens([{ role: 'user', content: 'x'.repeat(400) }])).toBeGreaterThan(100);
  });
});

describe('tapSseUsage', () => {
  it('passes bytes through and reads the usage chunk (incl. Groq x_groq)', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: {"choices":[],"x_groq":{"usage":{"prompt_tokens":7,"completion_tokens":2}}}\n\n',
      'data: [DONE]\n\n',
    ];
    let result: unknown;
    const out = await drain(tapSseUsage(sse(chunks).body!, (r) => { result = r; }));
    expect(out).toBe(chunks.join(''));
    expect(result).toEqual({ usage: { promptTokens: 7, completionTokens: 2 }, completionChars: 5, failed: false, signatures: new Map() });
  });
  it('an error event mid-stream counts as a failure (so routing steps around that model)', async () => {
    let result: { failed: boolean; error?: string } | undefined;
    const chunks = ['data: {"choices":[{"delta":{"content":"<html>"}}]}\n\n', 'data: {"error":{"message":"Upstream idle timeout exceeded","code":502}}\n\n'];
    const out = await drain(tapSseUsage(sse(chunks).body!, (r) => { result = r; }));
    expect(out).toBe(chunks.join('')); // the client still sees the error
    expect(result).toMatchObject({ failed: true, error: 'Upstream idle timeout exceeded' });
  });
  it('counts characters when there is no usage chunk, across split lines', async () => {
    let result: { usage: unknown; completionChars: number } | undefined;
    await drain(tapSseUsage(sse(['data: {"choices":[{"delta":{"con', 'tent":"abcd"}}]}\n\n']).body!, (r) => { result = r; }));
    expect(result).toMatchObject({ usage: null, completionChars: 4 });
  });
  it('reports failure when the upstream stream errors', async () => {
    const broken = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error('reset')); } });
    let failed: boolean | undefined;
    await expect(drain(tapSseUsage(broken, (r) => { failed = r.failed; }))).rejects.toThrow();
    expect(failed).toBe(true);
  });
});
