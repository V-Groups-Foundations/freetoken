import { createHash, randomBytes } from 'node:crypto';

export function hashApiToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateApiToken() {
  const raw = 'ft_' + randomBytes(32).toString('base64url');
  return { raw, hash: hashApiToken(raw), prefix: raw.slice(0, 10) };
}
