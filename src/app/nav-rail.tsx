'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/connect', label: 'Connect', icon: '🔌' },
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/images', label: 'Images', icon: '🎨' },
  { href: '/docs', label: 'Docs', icon: '📄' },
  { href: '/web', label: 'Web', icon: '🌐' },
  { href: '/studio', label: 'Studio', icon: '🕹️' },
  { href: '/tools', label: 'Tools', icon: '🛠️' },
  { href: '/projects', label: 'Projects', icon: '📁' },
  { href: '/dashboard', label: 'Usage', icon: '📊' },
  { href: '/settings', label: 'API', icon: '🔑' },
];

export function NavRail() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {LINKS.map((l, i) => {
        const active = pathname === l.href || pathname.startsWith(l.href + '/');
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
