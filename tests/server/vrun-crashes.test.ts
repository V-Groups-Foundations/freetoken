import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/db';
import { canViewCrashes, listCrashes, recordCrash, scrub } from '@/server/vrun-crashes';

describe('V-Run crash reports', () => {
  it('nothing personal survives: paths, emails, keys, query strings, addresses', () => {
    const s = scrub(String.raw`Error at C:\Users\taro.yamada\Desktop\shop\app.js for taro@example.co.jp with ft_abcdef1234567890XYZ sk-ant-api03-zzzzzzzzzzzz https://x.dev/cb?code=secret 192.168.1.20 /home/hana/x Bearer abc.def token=xyz`);
    for (const bad of ['taro', 'example.co.jp', 'ft_abcdef', 'sk-ant', 'code=secret', '192.168', 'hana', 'abc.def', 'xyz']) expect(s).not.toContain(bad);
    expect(s).toContain(String.raw`~\Desktop\shop\app.js`);
  });

  it('the same crash again counts up instead of adding a row; a different one is its own row', async () => {
    const db = await createTestDb();
    const r = { version: '0.2.0', os: 'win32 10.0.26100', kind: 'main-error', message: 'boom at 12', stack: 'Error: boom\n    at f (main.js:10:5)\n    at g (main.js:20:1)' };
    await recordCrash(db, r);
    await recordCrash(db, { ...r, message: 'boom at 13', stack: r.stack.replace('10:5', '11:5') });
    await recordCrash(db, { ...r, message: 'other' });
    const rows = await listCrashes(db);
    expect(rows).toHaveLength(2);
    expect(rows.find((x) => x.message.startsWith('boom'))?.count).toBe(2);
  });

  it('only the listed accounts may see them', () => {
    expect(canViewCrashes('Me@x.com', 'me@x.com, you@y.com')).toBe(true);
    expect(canViewCrashes('them@z.com', 'me@x.com')).toBe(false);
    expect(canViewCrashes('me@x.com', undefined)).toBe(false);
  });
});
