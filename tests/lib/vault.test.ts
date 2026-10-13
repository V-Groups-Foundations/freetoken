import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, loadMasterKey } from '@/lib/vault';
import { TEST_VAULT_KEY } from '../helpers/fixtures';

describe('vault', () => {
  it('round-trips', () => {
    expect(decrypt(encrypt('gsk_secret', TEST_VAULT_KEY), TEST_VAULT_KEY)).toBe('gsk_secret');
  });
  it('uses a fresh IV each time', () => {
    expect(encrypt('x', TEST_VAULT_KEY)).not.toBe(encrypt('x', TEST_VAULT_KEY));
  });
  it('rejects tampered ciphertext', () => {
    const buf = Buffer.from(encrypt('secret', TEST_VAULT_KEY), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decrypt(buf.toString('base64'), TEST_VAULT_KEY)).toThrow();
  });
  it('rejects the wrong key', () => {
    expect(() => decrypt(encrypt('s', TEST_VAULT_KEY), Buffer.alloc(32, 8))).toThrow();
  });
  it('validates master key length', () => {
    expect(() => loadMasterKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => loadMasterKey('')).toThrow(/not set/);
  });
});
