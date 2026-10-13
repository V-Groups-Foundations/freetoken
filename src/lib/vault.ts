import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Blob layout (base64): [version:1][iv:12][tag:16][ciphertext]
const VERSION = 1;

export function loadMasterKey(b64: string | undefined = process.env.VAULT_MASTER_KEY): Buffer {
  if (!b64) throw new Error('VAULT_MASTER_KEY is not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('VAULT_MASTER_KEY must be 32 bytes (base64)');
  return key;
}

export function encrypt(plaintext: string, key: Buffer = loadMasterKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decrypt(blob: string, key: Buffer = loadMasterKey()): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf[0] !== VERSION) throw new Error('Unsupported vault blob version');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
  decipher.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8');
}
