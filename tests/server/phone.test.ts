import { describe, it, expect } from 'vitest';
import type os from 'node:os';
import { isLocalHost, lanAddresses, safeNext } from '@/server/phone';

const nic = (address: string, family = 'IPv4', internal = false) => ({ address, family, internal, netmask: '', mac: '', cidr: null }) as os.NetworkInterfaceInfo;

describe('phone setup', () => {
  it("finds the address a phone can reach: private, Wi-Fi first, never a VM/VPN/WSL adapter", () => {
    const ips = lanAddresses({
      'vEthernet (WSL)': [nic('172.25.80.1')],
      'Ethernet': [nic('192.168.1.20')],
      'Wi-Fi': [nic('172.16.6.139'), nic('fe80::1', 'IPv6')],
      'Loopback Pseudo-Interface 1': [nic('127.0.0.1', 'IPv4', true)],
      'Tailscale': [nic('100.64.0.3')],
      'public': [nic('8.8.8.8')],
    } as ReturnType<typeof os.networkInterfaces>);
    expect(ips).toEqual(['172.16.6.139', '192.168.1.20']);
  });
  it('tells the computer itself from a phone', () => {
    expect(isLocalHost('localhost:3000')).toBe(true);
    expect(isLocalHost('127.0.0.1:3000')).toBe(true);
    expect(isLocalHost('172.16.6.139:3000')).toBe(false);
  });
  it('the sign-in link only sends you on to a page of this app', () => {
    expect(safeNext('/diet', '/connect')).toBe('/diet');
    expect(safeNext('/connect?welcome=1', '/x')).toBe('/connect?welcome=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', undefined, '']) expect(safeNext(bad, '/connect')).toBe('/connect');
  });
});
