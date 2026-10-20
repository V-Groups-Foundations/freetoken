---
name: seo
description: "Technical SEO for websites: titles and meta descriptions, Open Graph and Twitter cards, canonical URLs, heading structure, JSON-LD structured data, sitemap.xml, robots.txt, clean URLs, indexability, performance and mobile. Use when the user asks for SEO, search ranking, Google indexing, social share previews, meta tags or a sitemap."
---

# SEO

Technical SEO makes sure search engines can fetch, understand and fairly present every page. Content
quality does the rest.

## 1. Indexable HTML
- Important content must be in the server-rendered HTML (static site, SSR or prerendering). A
  client-only React SPA shows crawlers an empty `<div id="root">` at first; prefer Next.js/Astro or
  prerender for public pages.
- Real links: `<a href="/pricing">`, not click handlers. Every page reachable by links.
- Correct status codes: 404 for missing pages (not 200 with "not found"), 301 for moved pages.

## 2. Head tags for every page
```html
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice Templates for Freelancers | Billify</title>
  <meta name="description" content="Download 20 free invoice templates for freelancers. Edit in your browser, export to PDF, and get paid faster.">
  <link rel="canonical" href="https://billify.app/invoice-templates">
  <meta property="og:type" content="website">
  <meta property="og:title" content="Invoice Templates for Freelancers">
  <meta property="og:description" content="20 free templates. Edit in your browser, export to PDF.">
  <meta property="og:url" content="https://billify.app/invoice-templates">
  <meta property="og:image" content="https://billify.app/og/invoice-templates.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
```
- Title: unique per page, 50–60 characters, primary topic first, brand last.
- Description: unique, 140–160 characters, a reason to click; not keyword stuffing.
- Canonical: absolute URL of the preferred version (no tracking params; pick www or not, trailing slash or not).
- OG image: 1200×630 PNG/JPG, under ~1MB, absolute URL, text readable at small size.
- Next.js: use the `metadata` export / `generateMetadata` instead of raw tags.

## 3. Content structure
- One `<h1>` that matches the page topic; logical h2/h3 sections.
- Descriptive link text ("see pricing plans", not "click here").
- Images: descriptive file names and `alt`; dimensions set; modern formats.
- Internal links between related pages; breadcrumbs on deep sites.

## 4. Clean URLs
Lowercase, hyphenated, short, readable: `/blog/invoice-tips`, not `/p?id=123&cat=7`. Stable forever;
when changing, 301-redirect old to new. One URL per piece of content.

## 5. Structured data (JSON-LD)
Add in `<head>` or body; match visible content only. Pick the type for the page:
`Organization` + `WebSite` (home), `Article`/`BlogPosting`, `Product` with `Offer`, `FAQPage`,
`BreadcrumbList`, `LocalBusiness`, `SoftwareApplication`, `Event`.
```html
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"10 Invoice Tips for Freelancers",
 "datePublished":"2026-03-02","dateModified":"2026-03-10",
 "author":{"@type":"Person","name":"Dana Lee"},"image":"https://billify.app/og/invoice-tips.png"}
</script>
```
Validate at https://validator.schema.org or Google's Rich Results Test.

## 6. sitemap.xml and robots.txt
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://billify.app/</loc><lastmod>2026-03-10</lastmod></url>
  <url><loc>https://billify.app/invoice-templates</loc><lastmod>2026-03-08</lastmod></url>
</urlset>
```
```
User-agent: *
Disallow: /admin/
Sitemap: https://billify.app/sitemap.xml
```
- Sitemap lists only canonical, indexable, 200-status URLs; generate it from routes/content at build.
- Never `Disallow: /` in production. Use `<meta name="robots" content="noindex">` for pages that should
  not appear in results (robots.txt blocks crawling, not indexing).
- Staging sites: noindex everything (or password-protect).

## 7. Performance and mobile
Core Web Vitals are a ranking signal: see the web-performance skill (LCP < 2.5s, CLS < 0.1,
INP < 200ms). Responsive layout, readable 16px text, tap targets 44px, no intrusive popups.

## 8. After launch (tell the user)
Verify the domain in Google Search Console and Bing Webmaster Tools, submit the sitemap, check
coverage reports. Rankings take weeks.

## Check before you finish
1. Build/serve the site (run_app) and view the HTML source of 2–3 pages: title, description,
   canonical, OG tags, JSON-LD present and unique per page.
2. `Invoke-WebRequest http://localhost:3000/sitemap.xml` and `/robots.txt` return 200 with correct URLs
   (production domain, not localhost).
3. A missing URL returns status 404.
4. inspect_preview at mobile width: one h1, no console errors, images have alt.

## Common mistakes
- Same title/description on every page; titles over 70 characters.
- Canonical pointing to the home page from every page; relative OG image URLs.
- Shipping the staging `noindex` or `Disallow: /` to production.
- Structured data describing things not on the page (fake reviews).
