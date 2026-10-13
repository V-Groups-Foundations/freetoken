'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/connect', label: 'Connect' },
  { href: '/chat', label: 'Chat' },
  { href: '/projects', label: 'Projects' },
  { href: '/dashboard', label: 'Usage' },
  { href: '/settings', label: 'API' },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-6">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="navlink"
          data-active={pathname === l.href || pathname.startsWith(l.href + '/')}
        >
          {l.label}
        </Link>
      ))}
    </div>
  );
}
