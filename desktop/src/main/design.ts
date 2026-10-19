// The design brief the agent gets whenever the task is building a website or UI. Without it, models
// (especially small free ones) produce the most generic page possible; with a concrete quality bar,
// a default modern stack and a self-review step, the same models produce polished work.

/** Does this request (or the conversation so far) look like building / changing a web UI? */
export const isWebTask = (text: string) =>
  (process.env.VRUN_DESIGN_BRIEF ?? '').toLowerCase() !== 'off' &&
  /\b(web ?site|web ?page|landing|homepage|home page|web ?app|portfolio|dashboard|front-?end|ui\b|ux\b|html|css|tailwind|react|next\.?js|vue|svelte|page|site|navbar|hero section|style it|make it (look )?(nice|better|modern|beautiful|pretty))/i.test(text);

export const WEB_DESIGN_BRIEF = `
# Building websites and UIs — the quality bar
Deliver something that looks like a polished, modern product site, not a demo. Concretely:
- Stack: if the project already has one (React, Next, Vue, Tailwind…), use it. For a new site use a single index.html with Tailwind via its CDN (<script src="https://cdn.tailwindcss.com"></script>), the Inter font from Google Fonts, and small vanilla JS. No lorem ipsum, no "Feature 1 / Feature 2".
- Structure (adapt to the subject): sticky header with logo and nav; a hero with a specific, benefit-led headline, one-sentence subheadline, primary + secondary call-to-action and a visual; 2-4 content sections (features as a 3-column card grid with icons, how-it-works steps, testimonials or stats, pricing or a final CTA band); a real footer.
- Visual system: one brand colour plus neutrals (slate/zinc); a clear type scale (hero text-5xl-6xl font-bold tracking-tight, section titles text-3xl, body text-lg leading-relaxed text-slate-600); generous space (sections py-20+, content max-w-6xl mx-auto px-6, gap-6-8); rounded-2xl cards with a subtle border and shadow; soft gradients or a blurred colour glow behind the hero; consistent icon set (inline SVG / Lucide).
- Craft: hover and focus states on everything clickable, transition-colors/transform, smooth scrolling, a working mobile menu, fully responsive (check the layout at phone width: single column, nothing overflowing), semantic HTML, alt text, sufficient contrast, a <title> and a favicon (an inline SVG emoji is fine).
- Images: use real-looking imagery (https://images.unsplash.com/... with descriptive queries, or https://picsum.photos/seed/<word>/1200/800) or a tasteful SVG illustration — never broken links or grey boxes.
- Copy: write specific, confident copy for this exact product/person/business; invent plausible details rather than placeholders.
- Then look at it: start it with run_app (for a static site: npx serve .) and call inspect_preview. Check the hero, spacing, alignment, mobile layout and console errors; fix what's off before you say you're done. Summarise what you built and how to open it.
`.trim();
