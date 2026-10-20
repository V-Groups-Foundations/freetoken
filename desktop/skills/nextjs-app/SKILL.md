---
name: nextjs-app
description: "Build Next.js apps with the App Router: server vs client components, routes and layouts, route handlers, server actions, data fetching and caching, metadata/SEO, images, env vars and deploying. Use when the user asks for a Next.js app or site, or works in a project with next in package.json."
---

# Next.js app (App Router)

Next.js changes between major versions (caching defaults, async params, config names). Before relying
on an API, check the installed version (`npm ls next`) and read its bundled docs in
`node_modules/next/dist/docs/` if present (search them with grep), otherwise the version's docs on
nextjs.org. Follow the existing project's conventions over this file.

## 1. Scaffold (PowerShell)
```powershell
npx create-next-app@latest my-app --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --use-npm
cd my-app
```
Start with run_app: `npm run dev` (http://localhost:3000).

## 2. Routes and files (`src/app/`)
- `page.tsx` makes a route; folders are URL segments: `app/blog/[slug]/page.tsx` -> `/blog/hello`.
- `layout.tsx` wraps children and persists across navigation; the root layout has `<html>` and `<body>`.
- `loading.tsx` (Suspense fallback), `error.tsx` (must be `'use client'`), `not-found.tsx`.
- Route groups `(marketing)/` organize without changing URLs. Private folders `_components/`.
- `route.ts` = API endpoint (route handler): export `GET`, `POST`, etc.
- In Next 15+, `params` and `searchParams` are Promises: `const { slug } = await params;`.

## 3. Server vs client components
- Default is a Server Component: can be `async`, fetch data, read env secrets and the DB, sends no JS.
- Add `'use client'` at the top only for interactivity: state, effects, event handlers, browser APIs.
- Push `'use client'` down to the smallest leaf (a button, a form), keep pages and layouts server.
- Pass only serializable props (no functions, class instances) from server to client components.
- Never import server-only code (DB, secrets) into a client component; add `import 'server-only'`
  to such modules to make mistakes fail at build.

## 4. Data fetching and mutations
```tsx
// app/posts/page.tsx (Server Component)
export default async function Posts() {
  const posts = await db.post.findMany({ orderBy: { createdAt: 'desc' } });
  return <ul>{posts.map(p => <li key={p.id}>{p.title}</li>)}</ul>;
}
```
- Fetch in the server component that needs the data; run independent fetches with `Promise.all`.
- Caching differs by version: check whether `fetch` is cached by default in the installed version, and
  be explicit: `fetch(url, { cache: 'no-store' })` for live data, `{ next: { revalidate: 60 } }` for ISR,
  `export const dynamic = 'force-dynamic'` when a page must always render per request.
- Mutations: Server Actions (`'use server'` functions) called from `<form action={fn}>`; validate input
  with zod inside the action, check auth inside the action, then `revalidatePath('/posts')`.
- Route handlers (`route.ts`) for webhooks, external clients and non-form APIs.

## 5. Metadata and SEO
```tsx
export const metadata = { title: { default: 'Acme', template: '%s | Acme' },
  description: 'Invoices in 30 seconds.', openGraph: { images: ['/og.png'] } };
export async function generateMetadata({ params }) { const { slug } = await params; /* ... */ }
```
Add `app/sitemap.ts` and `app/robots.ts`; set `metadataBase` in the root layout.

## 6. Images, fonts, links
- `next/image` with `width`/`height` (or `fill` + sized parent) and `priority` for the LCP image.
  Remote images need `images.remotePatterns` in `next.config`.
- `next/font/google` (`import { Inter } from 'next/font/google'`) self-hosts fonts with no layout shift.
- `<Link href>` for internal navigation.

## 7. Env vars
`.env.local` (gitignored). Server-only by default; only `NEXT_PUBLIC_*` reach the browser. Secrets
never get the `NEXT_PUBLIC_` prefix. Restart the dev server after changing env files.

## 8. Build and deploy
```powershell
npm run build   # type-check, lint, prerender; must pass
npm run start   # production server on :3000
```
Vercel: push to GitHub and import the repo, or `npx vercel` / `npx vercel --prod`; set env vars in the
project settings. Elsewhere: `output: 'standalone'` in next.config for Docker (see docker-deploy).

## Check before you finish
1. `npm run build` passes (quote the summary); fix type and lint errors.
2. run_app `npm run dev` and inspect_preview key routes: no hydration warnings or console errors.
3. View page source of a public page: content and `<title>`/meta are in the HTML.
4. Mutations update the UI after submit (revalidation works).

## Common mistakes
- `'use client'` on pages/layouts, shipping everything to the browser.
- Hydration mismatches from `Date.now()`, `Math.random()` or `window` during render.
- Fetching your own route handlers from server components (call the function/DB directly).
- Assuming caching behavior from a different Next version.
- Using `pages/` router APIs (`getServerSideProps`) inside `app/`.
