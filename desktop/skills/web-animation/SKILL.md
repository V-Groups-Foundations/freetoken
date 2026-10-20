---
name: web-animation
description: "Motion design for websites and app UIs: when to animate, durations and easings, CSS transitions and keyframes, the Web Animations API, scroll reveals with IntersectionObserver, GSAP timelines, page transitions, micro-interactions, reduced motion and performance. Use when the user asks to animate, add motion, transitions, scroll effects, hover effects or make a page feel alive."
---

# Web animation

Motion should explain change (where something came from, what is happening), never just decorate.
(For a video export, use the html-video skill instead.)

## 1. When to animate
Animate: state changes (open/close, add/remove), feedback (press, success, error), orientation (page or
panel transitions), attention (one hero moment on a landing page). Do not animate: text people are
reading, things that happen 50 times a session, or anything that delays the user.

## 2. Timing and easing defaults
- Micro (hover, press, toggle): 120–200ms. UI (dropdown, modal, toast): 200–300ms. Large/page: 300–500ms.
  Hero sequences: up to 800ms per element. Exit is ~20% faster than enter.
- Easing: enter `cubic-bezier(.2,.8,.2,1)` (ease-out), exit `cubic-bezier(.4,0,1,1)` (ease-in),
  move on screen `cubic-bezier(.4,0,.2,1)`. Never `linear` except for spinners and progress.
- Distance: 8–24px for UI elements, 40–80px for hero reveals. Scale from .95, not from 0.
- Stagger lists by 40–80ms; cap the total stagger at ~400ms.

## 3. CSS first
```css
.btn{transition:transform .15s ease-out,background-color .15s ease-out}
.btn:active{transform:scale(.97)}
@keyframes rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
.reveal{opacity:0}
.reveal.in{animation:rise .6s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--i,0)*60ms)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;
  animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
```
List transitioned properties explicitly; `transition: all` animates layout by accident.

## 4. Scroll reveals (IntersectionObserver)
```js
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('.reveal').forEach((el, i) => { el.style.setProperty('--i', i % 6); io.observe(el); });
```
Reveal once; do not re-hide on scroll up. Content must be visible if JS fails: add `.reveal` only from
JS or put `<html class="js">` and scope the hidden state to `.js .reveal`.

## 5. Web Animations API (JS-driven, no library)
```js
el.animate([{ opacity: 0, transform: 'scale(.95)' }, { opacity: 1, transform: 'none' }],
  { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
```
Use it for enter/exit of elements added by JS; `await anim.finished` before removing an element.

## 6. GSAP for timelines and scroll scenes
```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js"></script>
<script>
gsap.registerPlugin(ScrollTrigger);
gsap.timeline({ defaults: { ease: 'power3.out', duration: .8 } })
  .from('.hero h1', { y: 40, opacity: 0 })
  .from('.hero p', { y: 20, opacity: 0 }, '-=.5')
  .from('.hero .cta', { scale: .9, opacity: 0 }, '-=.4');
gsap.to('.parallax', { yPercent: -20, ease: 'none', scrollTrigger: { trigger: '.parallax', scrub: true } });
</script>
```
npm: `npm i gsap`. In React use `@gsap/react` and its `useGSAP()` hook so animations clean up.
Use `gsap.matchMedia()` to skip effects under `(prefers-reduced-motion: reduce)`.

## 7. Page transitions
- Same-document: View Transitions API: `document.startViewTransition(() => updateDOM())`, with
  `view-transition-name` on shared elements. Feature-check it; fall back to an instant update.
- Multi-page sites: `@view-transition { navigation: auto; }` in CSS (Chromium); harmless elsewhere.
- React: Motion (`npm i motion`, `import { motion, AnimatePresence } from 'motion/react'`) for
  enter/exit and layout animations.

## 8. Performance
- Animate only `transform` and `opacity` (and `filter` sparingly). Never animate width, height, top,
  left, margin or box-shadow on large elements; fake shadows with a pseudo-element's opacity.
- `will-change: transform` only on elements about to animate, removed afterwards.
- Scroll handlers: use IntersectionObserver or ScrollTrigger, not `scroll` listeners doing layout reads.
- Keep it at 60fps on a mid phone; fewer, better animations beat many.

## Check before you finish
1. Run it (run_app or open the file) and inspect_preview: no console errors, content visible at load
   and after scrolling to the bottom.
2. Emulate reduced motion (or temporarily force the media query): everything still visible and usable.
3. Rapidly hover/click/toggle: no stuck states, no jank, no layout shift.
4. Nothing important waits more than ~500ms to appear.

## Common mistakes
- Hidden-until-animated content that stays invisible when JS or the observer fails.
- Everything fading up the same way; no hierarchy of motion.
- Long durations (1s+) on UI controls; bouncy easing on serious products.
- Forgetting reduced motion; infinite looping animations near text.
