import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google';
import { signOut } from '@/auth';
import { sessionUserId } from '@/lib/session';
import { NavRail } from './nav-rail';
import { CommandPalette } from './command-palette';
import { ThemeToggle, themeScript } from './theme-toggle';
import { Intro, introScript } from './intro';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });
const display = Space_Grotesk({ variable: '--font-display', subsets: ['latin'], weight: ['500', '600', '700'] });

export const metadata: Metadata = {
  title: 'FreeToken',
  description: 'Pool your free AI API tiers into one chat, one API, and one terminal.',
  icons: { icon: '/brand/freetoken.png', apple: '/brand/freetoken.png' },
  // added to an iPhone's home screen: full screen, named FreeToken
  appleWebApp: { capable: true, title: 'FreeToken', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = { themeColor: '#070b16', viewportFit: 'cover' };

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-1 py-1">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark, not an optimizable photo */}
      <img src="/brand/freetoken.png" alt="FreeToken" width={32} height={32} className="h-8 w-8 shrink-0 rounded-lg" />
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
        <script dangerouslySetInnerHTML={{ __html: introScript }} />
      </head>
      <body className="min-h-screen">
        <Intro />
        <div className="app-aurora" aria-hidden />
        <div className="app-circuit" aria-hidden />
        {/* phones: the rail is a bar across the top (its icons scroll sideways) and the page gets the whole
            width — beside a 72px rail every page was wider than the screen; from sm up it's the side rail.
            Clipped sideways: the hero glows reach past the edges on purpose (clip keeps the bar sticky) */}
        <div className="flex min-h-screen flex-col overflow-x-clip sm:flex-row">
          <aside className="sticky top-0 z-20 flex w-full shrink-0 flex-row items-center gap-2 overflow-x-auto border-b border-[color-mix(in_srgb,var(--border-strong)_55%,transparent)] bg-[color-mix(in_srgb,var(--surface)_80%,transparent)] p-2 backdrop-blur-xl sm:h-screen sm:w-[4.5rem] sm:flex-col sm:items-stretch sm:gap-4 sm:overflow-y-auto sm:overflow-x-hidden sm:border-b-0 sm:border-r sm:bg-[color-mix(in_srgb,var(--surface)_55%,transparent)] md:w-56 md:p-4">
            <Brand />
            {signedIn && <CommandPalette />}
            {signedIn && <NavRail />}
            <div className="flex flex-row gap-2 sm:mt-auto sm:flex-col sm:border-t sm:border-[var(--border)] sm:pt-3">
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
          <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-6 sm:px-6 sm:py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
