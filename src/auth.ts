import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { accounts, sessions, users, verificationTokens } from '@/db/schema';
import { localLoginEnabled, localLoginMatches, localOwner } from '@/server/local-login';
import { checkPassword } from '@/server/passwords';

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
    // This computer: the token from `npm run dev`'s welcome link (see src/server/local-login.ts)
    ...(localLoginEnabled()
      ? [
          Credentials({
            id: 'local',
            name: 'This computer',
            credentials: { token: {} },
            async authorize(c) {
              return localLoginMatches(c?.token) ? localOwner(getDb()) : null;
            },
          }),
        ]
      : []),
    // Email + password accounts (sign up on /login): same account, keys and chats every time
    Credentials({
      id: 'password',
      name: 'Email and password',
      credentials: { email: {}, password: {} },
      async authorize(c) {
        const user = await checkPassword(getDb(), c?.email, c?.password);
        return user ? { id: user.id, name: user.name, email: user.email, image: user.image } : null;
      },
    }),
    // Google confirms the address, so signing in with it reaches the account already made with that
    // email (e.g. on this computer, then copied online) instead of failing with "account not linked"
    ...(process.env.AUTH_GOOGLE_ID ? [Google({ allowDangerousEmailAccountLinking: true })] : []),
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
    jwt({ token, user, account }) {
      if (user?.id) token.sub = user.id;
      // how this session signed in: the private link ('local') is the owner's recovery key (see settings/password)
      if (account) token.via = account.provider;
      return token;
    },
    session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      (session as typeof session & { via?: string }).via = typeof token.via === 'string' ? token.via : undefined;
      return session;
    },
  },
}));
