---
name: landing-page
description: "Build a high-converting marketing landing page: choosing a structure, headline/subhead/CTA copy, social proof, features, pricing, FAQ, final CTA, a distinct visual direction, imagery, mobile and speed. Use when the user asks for a landing page, homepage, product page, marketing site, waitlist or launch page."
---

# Landing page

A landing page has one job: get one kind of visitor to take one action. Every section either builds the
case for that action or removes a reason not to take it.

## 1. Decide before building (write this in your reply)
- Audience: who arrives, and what they already know.
- The one action: sign up, book a demo, buy, join waitlist, download. One primary CTA label everywhere.
- The promise: the outcome they get, in their words.
- Visual direction: name it in 3 words (e.g. "editorial, warm, calm" or "technical, dark, precise") and
  pick fonts and palette to match. Do not default to purple gradients on white.

## 2. Pick a structure (not always the same one)
- **Classic SaaS:** hero, logo strip, 3 benefit blocks, feature deep-dives (alternating image/text),
  testimonials, pricing, FAQ, final CTA, footer.
- **Story / problem-first:** hero states the pain, "the old way" vs "the new way", how it works in
  3 steps, proof, CTA. Good for new categories.
- **Product-led / demo-first:** hero with a large live demo, video or interactive widget; short
  benefits; proof; CTA. Good for visual or developer tools.
- **Waitlist / launch:** hero + email form above the fold, 3 teaser benefits, count or social proof,
  repeat form. Short page.
- **Long-form sales:** for considered purchases: objections handled section by section, many proofs,
  guarantee, CTA repeated every 2–3 sections.

## 3. Copy rules
- Headline (6–12 words): the outcome, concrete. "Ship invoices in 30 seconds", not "The future of
  finance". Subhead (15–30 words): who it is for and how it works.
- CTA: verb + value: "Start free trial", "Get the template". Under it, a risk reducer: "No credit card.
  Cancel anytime."
- Benefits over features: lead with what changes for the user, then the feature that does it.
- Specific numbers beat adjectives ("cuts build time 40%"). Short paragraphs, 2–3 lines max.
- No lorem ipsum. If facts are unknown, write realistic, clearly plausible copy and tell the user which
  claims, numbers and testimonials they must replace with real ones.

## 4. Sections that convert
- **Hero:** headline, subhead, primary CTA (+ optional secondary "See how it works"), and a visual of
  the product or the result. Above the fold at 1280×720 and 375×667.
- **Social proof:** logos (grayscale, 5–7), testimonials with name, role, photo, and a specific result;
  ratings or user counts.
- **How it works:** 3 numbered steps.
- **Pricing:** 2–3 tiers, recommended tier highlighted, monthly/yearly toggle if relevant, the
  differences as a checklist, CTA on every tier.
- **FAQ:** 5–8 real objections (price, security, setup time, cancel, support) using `<details>`.
- **Final CTA:** restate the promise and repeat the primary button. Footer: links, legal, contact.

## 5. Visual quality
- Generous whitespace: 96–128px between sections on desktop, 64px on mobile.
- Big confident type: hero 48–72px desktop, 36–40px mobile; body 17–18px.
- One accent color used for CTAs; the rest neutral. Section backgrounds alternate subtly to pace the page.
- Imagery: real product screenshots in a browser/device frame, or purposeful illustration/SVG. Use
  Unsplash URLs (`https://images.unsplash.com/photo-...?w=1600&q=80&auto=format`) only when real
  photos fit. Every image has `alt`, `width`, `height`; below-the-fold images `loading="lazy"`.
- Motion: one hero entrance and subtle scroll reveals (see web-animation), respecting reduced motion.

## 6. Mobile and speed
- Design mobile-first: single column, CTA full width, sticky header with the CTA after scrolling.
- Fonts: at most 2 families via Google Fonts with `display=swap` and `preconnect`.
- Hero image: WebP/AVIF, at most ~200KB, `fetchpriority="high"`, not lazy.
- Target Lighthouse performance 90+; no heavy JS frameworks for a static page.
- Add title, meta description and Open Graph tags (see seo skill).

## Check before you finish
1. Open it with run_app (`npx serve .`) or open_preview and inspect_preview at 375px and 1280px widths.
2. The 5-second test: from the first screen alone, can you say what it is, for whom, and what to click?
3. The primary CTA appears in the hero, mid-page and at the end, with identical wording.
4. No console errors, no broken images, no horizontal scroll, all links/anchors work.
5. List the placeholder claims the user must replace.

## Common mistakes
- Vague headline ("Unlock your potential"); several competing CTAs.
- Same generic template every time: centered hero, three icon cards, gradient blob.
- Fake-looking testimonials without names or specifics.
- Giant unoptimized hero images; layout jumping as fonts and images load.
- Walls of text; features without benefits.
