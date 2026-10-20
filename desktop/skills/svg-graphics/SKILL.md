---
name: svg-graphics
description: "Create SVG graphics by hand: icons, logos, illustrations, patterns and backgrounds, using viewBox, simple geometric construction, paths, gradients, patterns, stroke vs fill, optimization, inline vs file use, and animating SVG with CSS. Use when the user asks for an icon, logo, illustration, vector graphic, decorative background, wave/blob divider or SVG animation."
---

# SVG graphics

Good hand-made SVG is built from a grid and simple shapes, with few colors and consistent strokes.

## 1. Set up the canvas
- Always a `viewBox`; let CSS control the size. Icons: `viewBox="0 0 24 24"`. Logos/illustrations:
  a round number such as `0 0 200 200` or `0 0 1200 600`. Draw within the box with 1–2 units of padding.
- `xmlns="http://www.w3.org/2000/svg"` is required in files; optional inline in HTML.
- Coordinates on whole or half numbers; keep the design on a grid (2 or 4 units).

## 2. Construct from primitives
Prefer `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` before free `path`s. Path commands:
`M` move, `L` line, `H`/`V` horizontal/vertical, `C` cubic curve, `Q` quadratic, `A` arc, `Z` close
(lowercase = relative). Compose a logo from 2–4 geometric shapes, aligned to the grid, with consistent
radii and stroke widths. Use `<g transform="translate(...) rotate(...)">` to position groups.

## 3. Icons: stroke style (Lucide-compatible)
```svg
<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="3" y="5" width="18" height="16" rx="2"/>
  <path d="M3 10h18M8 3v4M16 3v4"/>
</svg>
```
- `currentColor` so the icon takes the text color. Same stroke width (1.5 or 2) across the whole set.
- Optical size: the main shape fills about 18–20 of 24 units.
- Stroke vs fill: stroke icons for UI (light, consistent); filled for small sizes (12–16px), active
  states and logos. Do not mix styles in one set.

## 4. Logos
- Mark + wordmark. Mark must work at 16px (favicon) and in one color. Test it as a solid silhouette.
- For text in a logo, use a web font in HTML next to the SVG mark, or convert to paths in a design tool;
  SVG `<text>` depends on installed fonts.
- Provide variants: color, one-color (`currentColor`), and a square favicon (`favicon.svg`).

## 5. Gradients, patterns, filters
```svg
<svg viewBox="0 0 1200 600" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f172a"/><stop offset="1" stop-color="#1e3a8a"/>
    </linearGradient>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.5" fill="#ffffff" fill-opacity=".12"/>
    </pattern>
    <radialGradient id="glow"><stop offset="0" stop-color="#60a5fa" stop-opacity=".6"/><stop offset="1" stop-color="#60a5fa" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="600" fill="url(#bg)"/>
  <rect width="1200" height="600" fill="url(#dots)"/>
  <circle cx="900" cy="150" r="320" fill="url(#glow)"/>
  <path d="M0 520 C 300 460, 600 600, 1200 500 V600 H0 Z" fill="#ffffff"/>
</svg>
```
- Ids must be unique per page; prefix them (`hero-bg`) when several inline SVGs exist.
- Filters (`feGaussianBlur`, `feTurbulence` for grain) are expensive on large areas; use sparingly.
- Section dividers: a single wave `path` with `preserveAspectRatio="none"` stretched to full width.

## 6. Inline vs file
- Inline `<svg>` when it needs CSS styling, `currentColor`, or animation.
- `<img src="logo.svg" alt="Acme">` for static images (cacheable, no id clashes).
- CSS background: `url("data:image/svg+xml,...")` (URL-encode `#` as `%23`) for small patterns.
- Accessibility: decorative `aria-hidden="true"`; meaningful inline SVG gets `role="img"` and `<title>`.

## 7. Optimize
`npx svgo input.svg -o output.svg` removes metadata and editor junk. Keep precision to 1–2 decimals,
remove empty groups and unused defs. A hand-made icon should be under 1KB.

## 8. Animate with CSS
```css
.spin{animation:spin 1s linear infinite;transform-origin:center;transform-box:fill-box}
@keyframes spin{to{transform:rotate(360deg)}}
.draw path{stroke-dasharray:100;stroke-dashoffset:100;animation:draw 1.2s ease-out forwards}
@keyframes draw{to{stroke-dashoffset:0}}
@media (prefers-reduced-motion:reduce){.spin,.draw path{animation:none;stroke-dashoffset:0}}
```
Add `pathLength="100"` to a path so dasharray 100 equals its full length. Animate `transform` and
`opacity`; set `transform-box: fill-box` so rotation centers on the shape.

## Check before you finish
1. Open the page (open_preview / run_app) and inspect_preview: renders crisp at small (16–24px) and large sizes.
2. Icons recolor with `color`; logo legible at favicon size and in one color.
3. No duplicate ids across inline SVGs; no console errors.
4. File sizes reasonable after svgo.

## Common mistakes
- Missing `viewBox` (cannot scale) or hard-coded width/height fighting CSS.
- Off-grid coordinates with many decimals giving blurry edges.
- Mixed stroke widths and corner styles in one icon set.
- Relying on `<text>` with fonts the viewer does not have.
