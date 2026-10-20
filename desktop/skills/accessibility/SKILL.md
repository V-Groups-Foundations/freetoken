---
name: accessibility
description: "Make web UIs accessible (WCAG 2.2 AA): semantic HTML, labels, keyboard navigation, focus management for menus and modals, ARIA only when needed, color contrast ratios, alt text, motion, and testing with the keyboard and axe-core. Use when the user asks about accessibility, a11y, screen readers, keyboard support, contrast or WCAG, and when reviewing any UI."
---

# Accessibility

Native HTML elements are accessible by default. Most problems come from replacing them with divs.

## 1. Semantic structure
- Landmarks: one `<header>`, `<nav>`, `<main>`, `<footer>`; `<aside>` for side content.
- One `<h1>` per page; headings in order (h2 under h1, h3 under h2), chosen by structure, not size.
- Lists are `<ul>/<ol>`, tables of data are `<table>` with `<th scope="col">`.
- Actions are `<button type="button">`, navigation is `<a href>`. Never `<div onclick>`.
- `<html lang="en">` (correct language) and a meaningful `<title>` per page.
- Add a skip link as the first focusable element: `<a href="#main" class="skip">Skip to content</a>`.

## 2. Forms
- Every control has a label: `<label for="email">Email</label><input id="email" type="email" autocomplete="email">`.
  Visually hidden label only when the purpose is obvious from context (search with icon), using an
  `.sr-only` class, not `display:none`.
- Group radios/checkboxes in `<fieldset>` with `<legend>`.
- Errors: text (not color alone) next to the field, linked with `aria-describedby`, `aria-invalid="true"`
  on the field; on submit, move focus to the first invalid field or an error summary.
- Required fields marked in text ("required") plus the `required` attribute.

## 3. Keyboard
- Everything clickable is reachable with Tab and works with Enter/Space; order follows visual order.
- Never use positive `tabindex`. `tabindex="-1"` only for programmatic focus targets.
- Visible focus on everything: `:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`.
  Never `outline:none` without a replacement.
- Escape closes menus, popovers and dialogs. Arrow keys move within menus, tabs, listboxes.
- No keyboard traps (except a modal trapping focus inside itself while open).

## 4. Focus management
- Modals: use native `<dialog>` with `showModal()` (traps focus, Escape closes, inert background).
  Focus the first field or the dialog heading on open; return focus to the trigger on close.
- Route changes in SPAs: move focus to the new page's `<h1>` (with `tabindex="-1"`) or announce it.
- After deleting an item, move focus to a sensible neighbor, not to `<body>`.

## 5. ARIA: only when HTML cannot do it
- First rule: use the native element. ARIA changes what is announced, not behavior.
- Useful ARIA: `aria-label` on icon-only buttons; `aria-expanded` + `aria-controls` on disclosure
  buttons; `aria-current="page"` on the active nav link; `aria-live="polite"` region for async
  status ("Saved", "3 results"); `role="alert"` for urgent errors; `aria-hidden="true"` on decorative icons.
- Custom widgets (tabs, combobox, menu) must follow the WAI-ARIA Authoring Practices patterns exactly,
  or use a tested library (Radix UI, React Aria, Headless UI).

## 6. Color and contrast (WCAG AA)
- Normal text: at least **4.5:1**. Large text (24px+, or 18.66px+ bold): **3:1**.
- UI components and graphics (input borders, icons, focus rings, chart lines): **3:1** against neighbors.
- Do not convey meaning by color alone: add icons, text, patterns (errors, chart series, status).
- Common safe pairs: `#0f172a` on `#ffffff`, `#475569` muted text on white (7:1), white on `#4f46e5`.
  Light gray `#9ca3af` on white fails (2.5:1) for text.

## 7. Images, media, motion
- `alt` describes the purpose: informative images get a concise description; decorative images `alt=""`;
  linked images describe the destination. Do not start with "Image of".
- Videos: captions; no autoplay with sound. Provide pause for anything moving longer than 5 seconds.
- Respect `@media (prefers-reduced-motion: reduce)`: remove parallax, large movement and auto-animation.
- Touch targets at least 24×24px (WCAG 2.2), 44×44px recommended. Text resizable to 200% without loss;
  layout works at 320px width (reflow).

## 8. Automated check with axe-core
Inject into the page (dev only) and read results in the console, e.g. via inspect_preview:
```html
<script src="https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js"></script>
<script>
addEventListener('load', async () => {
  const r = await axe.run();
  console.log(r.violations.length + ' axe violations');
  r.violations.forEach(v => console.warn(v.impact, v.id, v.help, v.nodes.map(n => n.target.join(' '))));
});
</script>
```
In Playwright tests: `npm i -D @axe-core/playwright`, then `new AxeBuilder({ page }).analyze()`.
Automated tools catch about a third of issues; keyboard testing catches much of the rest.

## Check before you finish
1. axe reports 0 serious/critical violations (quote the count); remove the axe script afterwards.
2. Keyboard-only pass: Tab through the whole page, open and close every menu/dialog, submit every form.
3. Focus is always visible and never lost after dynamic changes.
4. Check contrast of text, muted text, placeholders and buttons in both light and dark themes.

## Common mistakes
- Placeholder used as the label; icon buttons without names.
- `role="button"` on divs instead of buttons; ARIA attributes that contradict the element.
- Modals that do not trap or return focus; focus outlines removed for looks.
- `alt` text stuffed with keywords or file names.
