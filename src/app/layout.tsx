import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono, Bricolage_Grotesque } from 'next/font/google';
import { signOut } from '@/auth';
import { sessionUserId } from '@/lib/session';
import { NavRail } from './nav-rail';
import { CommandPalette } from './command-palette';
import { ThemeToggle, themeScript } from './theme-toggle';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const display = Bricolage_Grotesque({ variable: '--font-display', subsets: ['latin'], weight: ['600', '700', '800'] });

export const metadata: Metadata = {
  title: 'FreeToken',
  description: 'Pool your free AI API tiers into one chat, one API, and one terminal.',
};

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-1 py-1">
      <span className="grad flex h-8 w-8 items-center justify-center rounded-xl text-[13px] font-bold text-white shadow-[0_4px_10px_-3px_rgba(6,165,215,0.5)]">ft</span>
      <span className="display hidden text-[16px] font-bold tracking-tight md:inline">FreeToken</span>
    </Link>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const signedIn = Boolean(await sessionUserId());
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${display.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 z-20 flex h-screen w-[4.5rem] shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] p-2 backdrop-blur md:w-56 md:p-4">
            <Brand />
            {signedIn && <CommandPalette />}
            {signedIn && <NavRail />}
            <div className="mt-auto flex flex-col gap-2 border-t border-[var(--border)] pt-3">
              <ThemeToggle />
              {signedIn ? (
                <form action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
                  <button className="btn btn-ghost btn-sm w-full justify-start gap-2" title="Sign out">
                    <span className="rail-ico" aria-hidden>⎋</span>
                    <span className="hidden md:inline">Sign out</span>
                  </button>
                </form>
              ) : (
                <Link href="/login" className="btn btn-secondary btn-sm w-full justify-start gap-2" title="Sign in">
                  <span className="rail-ico" aria-hidden>→</span>
                  <span className="hidden md:inline">Sign in</span>
                </Link>
              )}
            </div>
          </aside>
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
