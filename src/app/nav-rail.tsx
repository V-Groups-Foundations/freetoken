'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS: { href: string; label: string; icon: string; also?: string[] }[] = [
  { href: '/connect', label: 'Connect', icon: '🔌' },
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/images', label: 'Images', icon: '🎨' },
  { href: '/docs', label: 'Docs', icon: '📄' },
  { href: '/web', label: 'Web', icon: '🌐' },
  { href: '/voice', label: 'Voice', icon: '🎙️' },
  { href: '/studio', label: 'Studio', icon: '🕹️' },
  { href: '/tools', label: 'Tools', icon: '🛠️' },
  // projects live under V-Run: the list is /v-run, each project is /projects/<id>
  { href: '/v-run', label: 'V-Run', icon: '▶', also: ['/projects'] },
  { href: '/v-groups', label: 'V Groups', icon: '✦' },
  { href: '/dashboard', label: 'Usage', icon: '📊' },
  { href: '/settings', label: 'API', icon: '🔑' },
];

export function NavRail() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map((l, i) => {
        const active = [l.href, ...(l.also ?? [])].some((h) => pathname === h || pathname.startsWith(h + '/'));
        return (
          <Link
            key={l.href}
            href={l.href}
            data-active={active}
            className="rail-link"
            style={{ animationDelay: `${i * 35}ms` }}
            title={l.label}
          >
            <span className="rail-ico" aria-hidden>{l.icon}</span>
            <span className="hidden md:inline">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
