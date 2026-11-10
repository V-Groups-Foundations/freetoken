import { afterEach, describe, expect, it } from 'vitest';
import { localLoginMatches } from '@/server/local-login';

const secret = 'x'.repeat(43);

describe('hosted sign-in link', () => {
  afterEach(() => { delete process.env.FREETOKEN_LOGIN_TOKEN; delete process.env.FREETOKEN_LOCAL_LOGIN; });

  it('accepts the token kept in the host settings when there is no token file', () => {
    process.env.FREETOKEN_LOGIN_TOKEN = secret;
    expect(localLoginMatches(secret, '/nonexistent/local-login.token')).toBe(true);
    expect(localLoginMatches('y'.repeat(43), '/nonexistent/local-login.token')).toBe(false);
  });

  it('is off when local login is switched off, and refuses with no token anywhere', () => {
    process.env.FREETOKEN_LOGIN_TOKEN = secret;
    process.env.FREETOKEN_LOCAL_LOGIN = 'off';
    expect(localLoginMatches(secret, '/nonexistent/local-login.token')).toBe(false);
    delete process.env.FREETOKEN_LOGIN_TOKEN;
    delete process.env.FREETOKEN_LOCAL_LOGIN;
    expect(localLoginMatches(secret, '/nonexistent/local-login.token')).toBe(false);
  });
});
