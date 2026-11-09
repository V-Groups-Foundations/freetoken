// Using FreeToken from a phone on the same Wi-Fi: the computer's address on the local network, and the
// sign-in link (the same no-password token `npm run dev` opens on this computer) for a QR code.
import os from 'node:os';

const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
// adapters a phone can't reach: virtual switches, VPNs, VMs, Docker/WSL
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|tailscale|zerotier|vpn|tap|tun|utun|bridge|br-/i;

/** This computer's private IPv4 addresses, the likeliest one for a phone first (Wi-Fi, then Ethernet). */
export function lanAddresses(nets: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string[] {
  const found: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(nets)) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && PRIVATE.test(a.address) && !VIRTUAL.test(name)) found.push({ name, address: a.address });
    }
  }
  const rank = (n: string) => (/wi-?fi|wlan|wireless|^en0$/i.test(n) ? 0 : /ethernet|^eth|^en\d/i.test(n) ? 1 : 2);
  return found.sort((a, b) => rank(a.name) - rank(b.name)).map((f) => f.address);
}

/** True for a request that came from the phone side (any address but this computer's own name). */
export const isLocalHost = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

/** Where a sign-in link may send you afterwards: a page of this app, nothing else. */
export function safeNext(to: unknown, fallback: string) {
  return typeof to === 'string' && /^\/[a-z0-9/_-]*(\?[\w=&-]*)?$/i.test(to) && !to.startsWith('//') ? to : fallback;
}
