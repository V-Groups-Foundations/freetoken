// Pick a free TCP port for servers the agent starts — never 3000 (reserved by FreeToken).

import { createServer } from 'node:net';

const RESERVED = new Set([3000]);

function probe(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(0)); // taken/unusable
    srv.listen({ port, host: '127.0.0.1' }, () => {
      const chosen = srv.address().port;
      srv.close(() => resolve(chosen));
    });
  });
}

/** Resolve to an open port, honoring `preferred` when it's free and not reserved; else OS-assigned. */
export async function findFreePort(preferred) {
  if (preferred && !RESERVED.has(preferred)) {
    const got = await probe(preferred);
    if (got) return got;
  }
  const os = await probe(0); // 0 = OS assigns a free port
  return os || 5173;
}
