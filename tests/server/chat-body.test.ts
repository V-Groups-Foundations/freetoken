import { describe, it, expect } from 'vitest';
import { validateChatBody } from '@/server/chat-body';

const msgs = (n: number) => Array.from({ length: n }, () => ({ role: 'user', content: 'x' }));

describe('validateChatBody', () => {
  it('accepts a normal body', () => {
    expect(validateChatBody({ messages: msgs(1) }, 100)).toMatchObject({ ok: true });
  });
  it('rejects oversized, empty, too-many and non-object bodies', () => {
    expect(validateChatBody({ messages: msgs(1) }, 1_000_001)).toMatchObject({ ok: false, message: expect.stringContaining('1 MB') });
    expect(validateChatBody({ messages: [] }, 10)).toMatchObject({ ok: false });
    expect(validateChatBody({ messages: msgs(201) }, 10)).toMatchObject({ ok: false, message: expect.stringContaining('200') });
    expect(validateChatBody('hi', 2)).toMatchObject({ ok: false });
    expect(validateChatBody([], 2)).toMatchObject({ ok: false });
  });
  it('rejects messages that are not objects with a role (they used to crash routing with a 500)', () => {
    expect(validateChatBody({ messages: [null] }, 10)).toMatchObject({ ok: false, message: expect.stringContaining('messages[0]') });
    expect(validateChatBody({ messages: [{ role: 'user', content: 'hi' }, 'hello'] }, 10)).toMatchObject({ ok: false, message: expect.stringContaining('messages[1]') });
    expect(validateChatBody({ messages: [{ content: 'no role' }] }, 10)).toMatchObject({ ok: false });
    expect(validateChatBody({ messages: [{ role: 'user', content: 'hi' }] }, 10)).toMatchObject({ ok: true });
  });
});
