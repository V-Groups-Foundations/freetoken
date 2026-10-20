---
name: frontend-ui
description: "Build and redesign websites and web app interfaces that look professionally designed: visual direction, color palette and theme, layout, spacing and type scales, components and interaction states, forms, responsive breakpoints, dark mode, icons, imagery and accessibility basics, in plain HTML + Tailwind CDN or React. Use when the user asks to build, style, redesign, restyle, modernize or polish a site, app, page, component, form, card, navbar or modal, change its colors or layout, or make it look better, nicer, modern, futuristic or less generic."
---

# Frontend UI

Good UI is a system: a few tokens applied consistently, every state designed, every size tested.

## 1. Pick the stack
- No build step / single page: plain HTML + Tailwind Play CDN
  `<script src="https://cdn.tailwindcss.com"></script>` (v3, supports `tailwind.config = {...}` inline).
- An existing React/Vite project: follow its styling (Tailwind, CSS modules, or plain CSS). Do not add a
  second styling system.
- Icons: Lucide. HTML: `<script src="https://cdn.jsdelivr.net/npm/lucide@0/dist/umd/lucide.min.js"></script>`,
  write `<i data-lucide="search"></i>`, then call `lucide.createIcons()` after the DOM loads.
  React: `npm i lucide-react`, `import { Search } from 'lucide-react'`. Icons 16–20px inline, 24px standalone.

## 2. Define tokens before components
Put them on `:root` (or in `tailwind.config`) and use only these values:
- Spacing (4px base): 4, 8, 12, 16, 24, 32, 48, 64, 96. Padding inside a card 16–24; between sections 64–96.
- Type scale: 12, 14, 16 (body), 18, 20, 24, 30, 36, 48, 60. Line-height 1.5 for body, 1.1–1.25 for
  headings. Body text max width 60–75 characters (`max-w-prose` / `65ch`).
- Two font weights for body (400/500) and one for headings (600–700). One font family is enough; two max.
- Color: one neutral ramp (50–950), one brand/accent, plus semantic success/warning/danger. Accent is for
  primary actions and focus only, not decoration everywhere.
- Radius: one value for controls (6–8px), one for cards (12–16px). Shadows: 2 levels max.
```css
:root{--bg:#fff;--surface:#f8fafc;--text:#0f172a;--muted:#64748b;--border:#e2e8f0;--accent:#4f46e5;--accent-fg:#fff;--danger:#dc2626;--radius:8px}
@media (prefers-color-scheme:dark){:root{--bg:#0b0f17;--surface:#131a26;--text:#e2e8f0;--muted:#94a3b8;--border:#243044;--accent:#818cf8;--accent-fg:#0b0f17}}
body{background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
```

## 3. Layout
- Page skeleton: CSS grid for 2-D structure (sidebar + main, card grids), flexbox for 1-D rows (toolbars,
  button groups, nav). Card grids: `grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:24px`.
- Container: `max-width:1200px; margin-inline:auto; padding-inline:16px` (24px from 768px up).
- Align everything to the spacing scale; never mix 13px and 17px gaps.
- Breakpoints (Tailwind defaults): sm 640, md 768, lg 1024, xl 1280. Build mobile-first; test 375px,
  768px and 1280px widths. No horizontal scroll at 375px.

## 4. Design every state
For each interactive element:
- default, hover (slight bg/border shift), focus-visible (2px accent ring with 2px offset, never removed),
  active (pressed: darker or `translateY(1px)`), disabled (opacity .5, `cursor:not-allowed`, no hover).
- Loading: button keeps its width, shows a spinner and disables itself; lists show skeletons shaped like
  the content, not a centered spinner.
- Empty: icon + one sentence of what goes here + the primary action ("No projects yet. Create project").
- Error: say what happened and what to do, in plain words, next to where it happened, with a retry.
- Transitions 150–200ms ease-out on color/background/border/box-shadow/transform only.

## 5. Forms
- Every input has a visible `<label for>`; placeholder is an example, not the label.
- Inputs at least 40px tall (44px on touch), 16px font (prevents iOS zoom).
- Validate on blur and on submit; show the error under the field in danger color with
  `aria-describedby` pointing to it; keep the user's input.
- Group related fields; one column on mobile; primary button on the right in dialogs, left-aligned
  under the form on pages. Button label is a verb: "Save changes", not "Submit".
- Use the right `type` and `autocomplete` (email, tel, current-password, new-password).

## 6. Dark mode
- Swap tokens, not components. Dark background is near-black with a hint of hue (#0b0f17), not #000.
- Elevation in dark mode = lighter surface, not bigger shadow. Lower accent saturation slightly.
- If the user can toggle: set `data-theme` on `<html>`, persist in localStorage, default to system.

## 7. Accessibility basics
Semantic elements (`button`, `a`, `nav`, `main`, `h1`–`h3` in order), text contrast at least 4.5:1
(3:1 for large text and UI borders), hit targets at least 44×44px on touch, icon-only buttons get
`aria-label`, everything reachable by Tab in a sensible order.

## Check before you finish
1. Start it (run_app with the dev server, or open the HTML file) and inspect_preview at 375px and 1280px.
2. No console errors; no overflow or clipped text; images have width/height.
3. Tab through the page: every control is reachable and has a visible focus ring.
4. Trigger loading, empty and error states at least once (fake data if needed).
5. Check dark mode if the page supports it.

## Common mistakes
- Random one-off values (margin 13px, #3b3b3b) instead of tokens.
- `outline:none` without a replacement focus style.
- Gray text on colored backgrounds that fails contrast; light gray (#999) body text on white.
- Everything centered, everything bold, accent color on every element.
- Only the happy path designed; no empty, loading or error states.
- Using `div onclick` instead of `button`.
