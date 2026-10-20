---
name: react-app
description: "Create and structure a React single-page app with Vite and TypeScript: scaffolding, folder structure, state (useState, useReducer, Zustand), data fetching, routing with react-router, forms, env vars, build and preview. Use when the user asks for a React app, SPA, Vite project or React frontend (not Next.js)."
---

# React app (Vite)

Vite + React + TypeScript is the default for a client-side app. For SEO-heavy sites or server
rendering, use the nextjs-app skill instead.

## 1. Scaffold (PowerShell)
```powershell
npm create vite@latest my-app -- --template react-ts
cd my-app
npm install
```
Then start it with run_app: `npm run dev` (serves http://localhost:5173). If the folder already
exists, scaffold into `.` only when it is empty.
Optional: Tailwind v4 via `npm i tailwindcss @tailwindcss/vite`, add `tailwindcss()` to `plugins` in
`vite.config.ts`, and `@import "tailwindcss";` at the top of `src/index.css`.

## 2. Structure
```
src/
  main.tsx            # createRoot, Router, providers
  App.tsx             # routes / layout
  pages/              # one component per route
  components/         # reusable UI (Button, Modal, ...)
  features/<name>/    # feature-specific components, hooks, api calls
  hooks/              # shared hooks (useDebounce, ...)
  lib/api.ts          # fetch wrapper
  types.ts
```
One component per file, PascalCase names. Keep components under ~200 lines; extract when they grow.

## 3. State: smallest thing that works
- Local UI state: `useState`. Several related fields with transitions: `useReducer`.
- Shared by a few nearby components: lift state to the common parent and pass props.
- App-wide client state (cart, theme, auth user): Zustand (`npm i zustand`):
```ts
import { create } from 'zustand';
type Cart = { items: Item[]; add: (i: Item) => void };
export const useCart = create<Cart>((set) => ({ items: [], add: (i) => set((s) => ({ items: [...s.items, i] })) }));
```
- Server data is not app state: fetch it (below). Derive values during render instead of syncing them
  with `useEffect`.

## 4. Data fetching
- Small apps: a `lib/api.ts` wrapper (base URL, JSON, throw on `!res.ok`) and a hook with loading/error.
- Real apps: TanStack Query (`npm i @tanstack/react-query`): caching, retries, refetch, mutations.
```tsx
const { data, isPending, error } = useQuery({ queryKey: ['todos'], queryFn: () => api.get<Todo[]>('/todos') });
if (isPending) return <Skeleton />;
if (error) return <ErrorBox message={error.message} />;
```
- If you use raw `useEffect` + fetch, abort on cleanup with `AbortController` to avoid race conditions.
- Dev API proxy in `vite.config.ts`: `server: { proxy: { '/api': 'http://localhost:3000' } }` (avoids CORS).

## 5. Routing
`npm i react-router` (v7; import from `'react-router'`).
```tsx
import { BrowserRouter, Routes, Route } from 'react-router';
<BrowserRouter><Routes>
  <Route element={<Layout />}>
    <Route index element={<Home />} />
    <Route path="items/:id" element={<ItemPage />} />
    <Route path="*" element={<NotFound />} />
  </Route>
</Routes></BrowserRouter>
```
`Layout` renders `<Outlet />`. Use `<Link>`/`useNavigate`, `useParams` for `:id`. Put filters in the URL
with `useSearchParams`. When deploying, configure the host to rewrite all paths to `index.html`.

## 6. Forms
Simple: controlled inputs with `useState` and a submit handler that validates. Larger: React Hook Form +
zod (`npm i react-hook-form zod @hookform/resolvers`). Disable the submit button while submitting, show
field errors under fields, keep input on error.

## 7. Env vars
Only variables prefixed `VITE_` reach the browser: `.env` -> `VITE_API_URL=http://localhost:3000`,
read with `import.meta.env.VITE_API_URL`. Anything in the frontend bundle is public: never put secret
API keys there; call those APIs from a backend.

## 8. Build and preview
```powershell
npm run build     # type-checks (tsc -b) and outputs dist/
npm run preview   # serves dist/ at http://localhost:4173
```
Fix all TypeScript errors; do not silence them with `any` or `@ts-ignore`.

## Check before you finish
1. `npm run build` succeeds with no errors (quote the result).
2. run_app `npm run dev`, then inspect_preview the main routes: no console errors or React warnings
   (missing `key`, effect loops), loading and error states render.
3. Refresh on a nested route works in dev; deep links work in preview.
4. Tests if present: `npx vitest run` (see testing skill).

## Common mistakes
- `useEffect` to compute derived state, causing extra renders or loops.
- Missing dependency arrays or objects recreated each render causing infinite fetches.
- Using array index as `key` for lists that reorder.
- Secret keys in `VITE_` variables. Mutating state directly (`items.push`).
- Installing react-router-dom v6 tutorials' APIs into a v7 project without checking.
