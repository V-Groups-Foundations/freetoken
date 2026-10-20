---
name: auth-security
description: "Implement authentication and authorization securely: password hashing with argon2/bcrypt, sessions vs JWT, secure cookies, CSRF, OAuth via Auth.js or Passport, rate limiting, server-side role checks and secret management. Use when the user asks for login, signup, accounts, auth, OAuth/social login, permissions, roles or securing an app."
---

# Auth and security

Use a proven library for the hard parts; your job is wiring it correctly and checking permissions
on the server for every request.

## 1. Choose the approach
- Next.js: Auth.js (`npm i next-auth@beta`, v5) for OAuth/email, or Better Auth (`npm i better-auth`)
  for email+password with sessions in your DB.
- Express: `express-session` + a DB session store, plus Passport (`passport-local`, `passport-google-oauth20`) for OAuth.
- FastAPI: server-side sessions or short JWTs via `pyjwt`, hashing with `argon2-cffi` (or `pwdlib`).
- Hosted alternative when the user wants zero auth code: Clerk, Supabase Auth.

## 2. Sessions vs JWT
- Default: **server sessions**. Random id (32+ bytes) in a cookie, session row in DB/Redis. Easy to
  revoke, logout works, small cookie.
- JWT: when separate services must verify tokens without a shared DB. Keep access tokens short
  (5–15 min), refresh tokens rotated and stored server-side so they can be revoked.
- Never store tokens in localStorage (readable by any XSS). Put them in cookies.

## 3. Cookies
`Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600`
- `HttpOnly` always, `Secure` in production (HTTPS), `SameSite=Lax` default (`Strict` for high-value
  apps, `None; Secure` only for real cross-site needs).
- Regenerate the session id on login and privilege change (prevents session fixation). Destroy on logout.

## 4. Passwords
```js
import argon2 from 'argon2';                       // npm i argon2
const hash = await argon2.hash(password);          // argon2id defaults
const ok = await argon2.verify(hash, password);
```
bcrypt alternative: `npm i bcrypt`, cost 12. Python: `from argon2 import PasswordHasher`.
- Minimum 8 characters (12 recommended), allow long passphrases and all characters; check against
  breached lists if possible. No forced composition rules.
- Same error for wrong email and wrong password ("Invalid email or password").
- Password reset: random single-use token, store its hash, expires in 30–60 min, invalidate sessions after reset.

## 5. CSRF
Cookie-authenticated, state-changing requests (POST/PUT/PATCH/DELETE) need protection: `SameSite=Lax`
cookies plus either a CSRF token (synchronizer or double-submit) or a strict `Origin` header check.
Never change state on GET. Auth.js and Next Server Actions include protections; Express needs it added.

## 6. OAuth
Use the library's provider; never hand-roll the flow. Register the exact callback URL
(`http://localhost:3000/api/auth/callback/google` in dev, the real domain in prod). Use `state`/PKCE
(libraries do). Link accounts by verified email only.

## 7. Authorization (the part people forget)
- Check on the server for every request: authenticated? and allowed on *this* resource?
```js
const task = await db.task.findUnique({ where: { id } });
if (!task || task.ownerId !== req.user.id) return res.status(404).end(); // 404 hides existence
```
- Roles: `user.role` in DB (`'user' | 'admin'`), a `requireRole('admin')` middleware. Hiding a button
  in the UI is not authorization.
- Scope every query by the owner/tenant id. Validate ids from the client; never trust a `userId` in the body.

## 8. Hardening checklist
- Rate limit login, signup, reset: e.g. 5 attempts/min per IP+account (`express-rate-limit`,
  `@fastify/rate-limit`, `slowapi` for FastAPI). Return 429.
- Secrets (`AUTH_SECRET`, DB URL, OAuth secrets) only in `.env`, generated randomly
  (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`); `.env` in `.gitignore`.
- Security headers: `helmet` for Express; CSP where possible. HTTPS in production.
- Parameterized queries only; escape output (React does by default; avoid `dangerouslySetInnerHTML`).
- Log auth events (login, failure, reset) without passwords or tokens.

## Check before you finish
1. Sign up, log in, refresh the page (still logged in), log out (session gone, back button cannot act).
2. With user A's session, request user B's resource by id: expect 404/403.
3. Call an admin endpoint as a normal user: expect 403. Call any protected endpoint with no cookie: 401.
4. Inspect the cookie in the browser (inspect_preview / devtools): HttpOnly, SameSite set.
5. 6 rapid wrong logins trigger 429. Search the repo for hard-coded secrets.

## Common mistakes
- Checking auth in middleware but not ownership per resource.
- JWT in localStorage; long-lived JWTs that cannot be revoked; `alg: none` accepted.
- Plain SHA-256 or MD5 password hashes.
- Different errors that reveal which emails exist.
- Committing `.env` or putting secrets in `NEXT_PUBLIC_`/`VITE_` variables.
