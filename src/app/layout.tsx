import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono } from 'next/font/google';
import { signOut } from '@/auth';
import { sessionUserId } from '@/lib/session';
import { NavLinks } from './nav-links';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FreeToken',
  description: 'Pool your free AI API tiers into one chat, one API, and one terminal.',
};

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--brand)] text-[13px] font-bold text-white">ft</span>
      <span className="text-[15px] font-semibold tracking-tight">FreeToken</span>
    </Link>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = Boolean(await sessionUserId());
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_85%,transparent)] backdrop-blur">
          <nav className="mx-auto flex h-14 max-w-5xl items-center gap-8 px-4 sm:px-6">
            <Brand />
            {signedIn ? (
              <>
                <NavLinks />
                <form className="ml-auto" action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
                  <button className="btn btn-ghost btn-sm">Sign out</button>
                </form>
              </>
            ) : (
              <Link href="/login" className="btn btn-secondary btn-sm ml-auto">Sign in</Link>
            )}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </body>
    </html>
  );
}
