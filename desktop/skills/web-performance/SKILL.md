---
name: web-performance
description: "Make websites and APIs fast: images (formats, sizes, lazy loading), fonts, critical CSS, JavaScript size, caching headers, Core Web Vitals (LCP, CLS, INP) and what drives each, plus backend N+1 queries, caching and compression. Use when the user says the site is slow, asks to optimize performance, improve Lighthouse or PageSpeed scores, or reduce load time."
---

# Web performance

Measure first, fix the biggest cost, measure again. Do not optimize blind.

## 1. Measure
- Lighthouse in Chrome DevTools (mobile, simulated throttling) or `npx lighthouse http://localhost:3000 --view`.
  Measure a production build (`npm run build` + `npm run preview`/`npm run start`), never the dev server.
- Targets (Core Web Vitals, 75th percentile): **LCP < 2.5s**, **CLS < 0.1**, **INP < 200ms**.
  Also: total JS < ~200KB gzipped for a typical page, page weight < 1.5MB.
- Note the before numbers so you can report the improvement.

## 2. LCP (largest contentful paint): make the main content appear fast
Usually the hero image or headline. Fix with:
- Hero image: modern format (AVIF/WebP), sized to its display size (serve `srcset` with 640/1280/1920
  widths and `sizes`), `fetchpriority="high"`, never `loading="lazy"`. Preload if it is a CSS background.
- Fast server response (TTFB < 800ms): static/prerendered HTML or caching, CDN.
- No render-blocking resources: inline critical CSS for above-the-fold or keep CSS small; scripts
  `defer` or `type="module"`; no synchronous third-party scripts in `<head>`.
- Do not hide the hero behind JS rendering or a fade-in animation that starts late.

## 3. CLS (layout shift): nothing jumps
- Every `<img>`/`<video>`/`<iframe>` has `width` and `height` attributes (or CSS `aspect-ratio`).
- Reserve space for ads, embeds, banners and async content (skeletons at final size).
- Fonts: `font-display: swap` plus a fallback with similar metrics; `next/font` or `size-adjust` fixes shifts.
- Never insert content above existing content except in response to user input. Animate transform, not top/height.

## 4. INP (interaction latency): respond within 200ms
- Break long tasks (>50ms): chunk work, `await scheduler.yield()` / `setTimeout(0)` between chunks,
  move heavy computation to a Web Worker.
- Debounce input handlers (search: 250ms); virtualize long lists (`@tanstack/react-virtual`) over ~200 rows.
- React: avoid re-rendering huge trees on each keystroke (memoize, split state, `useDeferredValue`).
- Reduce third-party scripts (chat widgets, tag managers); load them after interaction or `defer`.

## 5. Images
- Formats: AVIF or WebP for photos, SVG for icons/logos, PNG only for screenshots needing lossless.
- Compress: quality ~75–80. Convert with `npx sharp-cli` or squoosh.app. Photos typically < 200KB.
- Below the fold: `loading="lazy" decoding="async"`. Use framework image components when available.

## 6. Fonts
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
```
Max 2 families, only the weights used; variable fonts when using 3+ weights; self-host (WOFF2) for best results.

## 7. JavaScript and CSS size
- Inspect bundles: `npx vite-bundle-visualizer`, or `@next/bundle-analyzer`.
- Replace heavy libraries (moment -> date-fns or `Intl`, lodash -> native or per-function imports).
- Code-split routes and heavy components (`React.lazy`, dynamic `import()`, `next/dynamic`).
- Remove unused CSS (Tailwind does this automatically); avoid huge icon packs, import icons individually.

## 8. Caching and delivery
- Hashed static assets (`app.3f9a1c.js`): `Cache-Control: public, max-age=31536000, immutable`.
- HTML: `Cache-Control: no-cache` (revalidate) or short `s-maxage` on a CDN.
- API responses: `ETag`/`Last-Modified`, or short max-age for public data.
- Compression: Brotli or gzip for text (hosts like Vercel/Netlify/Cloudflare do this; Express:
  `npm i compression`, FastAPI: `GZipMiddleware`). Serve over HTTP/2+ via a CDN.

## 9. Backend
- N+1 queries: one query per list item. Fix with joins/`include`/`select_related`/`selectinload` or a
  batched `WHERE id IN (...)`. Log query counts per request to find them.
- Add indexes for slow filtered/sorted queries (check with `EXPLAIN ANALYZE`).
- Cache expensive, rarely-changing results (in-memory LRU or Redis) with a TTL and explicit invalidation.
- Paginate lists; select only needed columns; do slow work (emails, image processing) in a background job.
- Time it: `Measure-Command { Invoke-RestMethod http://localhost:3000/api/items }` in PowerShell.

## Check before you finish
1. Re-run Lighthouse on the production build; report before/after LCP, CLS, INP/TBT and score.
2. inspect_preview: no console errors, images sharp at their size, no visible layout jumps on load.
3. Network: no oversized images (>300KB), no duplicate libraries, assets cached and compressed.
4. Functionality unchanged (run the tests).

## Common mistakes
- Lazy-loading the LCP image; measuring the dev server.
- Shipping 4MB PNG photos; images without dimensions.
- Adding a library to solve a 10-line problem.
- Caching HTML forever so deploys never reach users.
