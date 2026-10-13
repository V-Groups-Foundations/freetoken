import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { accounts, sessions, users, verificationTokens } from '@/db/schema';

export const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    ...(process.env.AUTH_GOOGLE_ID ? [Google] : []),
    ...(devLoginEnabled
      ? [
          Credentials({
            id: 'dev',
            name: 'Dev login',
            credentials: { email: {} },
            async authorize(c) {
              const email = String(c?.email ?? '').trim().toLowerCase();
              if (!email.includes('@')) return null;
              const db = getDb();
              const [existing] = await db.select().from(users).where(eq(users.email, email));
              if (existing) return existing;
              const [created] = await db.insert(users).values({ email, name: email.split('@')[0] }).returning();
              return created;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
}));
