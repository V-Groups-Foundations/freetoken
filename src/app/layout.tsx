import type { Metadata } from 'next';
import Link from 'next/link';
import { Geist, Geist_Mono } from 'next/font/google';
import { auth, signOut } from '@/auth';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FreeToken',
  description: 'Combine your free AI API tiers into one chat and one API.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900">
        <header className="border-b bg-white">
          <nav className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold">FreeToken</Link>
            {session && (
              <>
                <Link href="/connect">Connect</Link>
                <Link href="/chat">Chat</Link>
                <Link href="/settings">API</Link>
                <form className="ml-auto" action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
                  <button className="text-neutral-500 hover:text-neutral-900">Sign out</button>
                </form>
              </>
            )}
            {!session && <Link href="/login" className="ml-auto">Sign in</Link>}
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
