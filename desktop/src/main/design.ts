// The design brief the agent gets whenever the task is building a website or UI. Without it, models
// (especially small free ones) produce the most generic page possible. A single fixed recipe made every
// site look the same, so each project gets its own design direction (palette, type, layout, details),
// picked from the project so it stays consistent there and differs between projects.
import { createHash } from "node:crypto";

/** Does this request (or the conversation so far) look like building / changing a web UI? */
export const isWebTask = (text: string) =>
  (process.env.VRUN_DESIGN_BRIEF ?? '').toLowerCase() !== 'off' &&
  /\b(web ?site|web ?page|landing|homepage|home page|web ?app|portfolio|dashboard|front-?end|ui\b|ux\b|html|css|tailwind|react|next\.?js|vue|svelte|page|site|navbar|hero section|style it|make it (look )?(nice|better|modern|beautiful|pretty))/i.test(text);

/** A video / motion request: the html-video skill applies rather than the website brief. */
export const isVideoTask = (text: string) =>
  /\b(video|animation|animated|motion graphics?|explainer|intro sequence|title sequence|trailer|promo clip|reel|mp4)\b/i.test(text);

export interface Direction { name: string; mood: string; palette: string; type: string; layout: string; details: string }

export const DIRECTIONS: Direction[] = [
  { name: "Editorial", mood: "a serious magazine — calm, confident, lots of reading rhythm",
    palette: "warm paper #f6f1e7, ink #1b1b1b, one accent (oxblood #8a1c1c or deep green #1f4d3a)",
    type: "a high-contrast serif for headings (Fraunces, Playfair Display or DM Serif Display) + a clean sans for text (Inter Tight, Source Sans 3)",
    layout: "big typographic hero with no image or one strong photo, multi-column text, pull quotes, thin rules between sections, numbered sections",
    details: "drop caps, small caps labels, hairline borders, generous margins, almost no shadows or rounded corners" },
  { name: "Swiss grid", mood: "precise, informational, International Typographic Style",
    palette: "white, black, one loud primary (signal red #e3000f, cobalt #0047ff or yellow #ffd400)",
    type: "a neo-grotesk only (Inter, Archivo or Helvetica-like 'Schibsted Grotesk'), huge weights contrast",
    layout: "strict 12-column grid, asymmetric blocks, oversized numbers and headings aligned flush left, content in modules",
    details: "no gradients, no rounded corners, solid colour blocks, underlines on hover, arrows → as UI" },
  { name: "Neo-brutalist", mood: "loud, playful, internet-native",
    palette: "off-white #fffdf5 with saturated flats (lime #c6f432, pink #ff6ad5, sky #6ad1ff) and pure black outlines",
    type: "a chunky display (Space Grotesk, Archivo Black or Bricolage Grotesque) + a mono for labels (JetBrains Mono)",
    layout: "stacked cards and stickers, tilted elements, marquee ticker, bento of mismatched sizes",
    details: "2–3px black borders, hard offset shadows (6px 6px 0 #000), buttons that press down, emoji/stickers used sparingly" },
  { name: "Luxury minimal", mood: "quiet, premium, slow",
    palette: "near-black #0e0e0e or ivory #f4f1ec, champagne/gold accent #b89b5e, muted greys",
    type: "an elegant light serif or wide sans for display (Cormorant Garamond, Italiana, or 'Syne' light), letter-spaced uppercase labels",
    layout: "full-bleed photography, very few words per screen, centred compositions, long vertical rhythm",
    details: "thin 1px lines, slow fades and parallax, tiny UI, no cards, no icons grid" },
  { name: "Retro 70s / warm", mood: "friendly, sunny, nostalgic",
    palette: "cream #fbf0d9, burnt orange #e2711d, mustard #e9b44c, brown #5c3d2e, teal #2a7f78",
    type: "a soft rounded display (Recoleta-like 'Fraunces' soft, 'Shrikhand' for one word, or 'Righteous') + a warm sans (Nunito Sans, DM Sans)",
    layout: "sunburst/arch shapes, wavy section dividers, stacked rounded blobs, big friendly headline",
    details: "grain texture overlay, pill buttons, hand-drawn underline SVGs, illustrated icons" },
  { name: "Dark tech / terminal", mood: "developer tool, precise, fast",
    palette: "near-black #0a0c10, panel #11151c, neon accent (green #3dff9a or amber #ffb000), dim greys",
    type: "mono-forward (JetBrains Mono, IBM Plex Mono) for headings and UI + Inter for body",
    layout: "hero with a live-looking terminal or code block, feature list as command outputs, keyboard shortcuts, changelog",
    details: "blinking cursor, scanline or dot-grid background, 1px borders, kbd elements, subtle glow only on the accent" },
  { name: "Soft pastel / glass", mood: "calm consumer app, gentle",
    palette: "very light tints (lilac #efe9ff, mint #e3fbf1, peach #ffeee3) with one saturated accent and deep navy text",
    type: "a geometric rounded sans (Plus Jakarta Sans, Outfit, Manrope)",
    layout: "floating phone/device mockups, overlapping translucent panels, centred hero with app badges",
    details: "backdrop-blur glass cards, big radii (24–32px), soft coloured shadows, gentle floating motion" },
  { name: "Organic / earthy", mood: "natural, handmade, sustainable",
    palette: "sand #efe6d8, olive #6b705c, terracotta #c8553d, forest #283618, bone #fefae0",
    type: "a humanist serif (Lora, Newsreader, EB Garamond) + a soft sans (Work Sans)",
    layout: "irregular image crops (arches, blobs), text wrapping around images, asymmetric two-column stories",
    details: "paper texture, botanical line illustrations, rounded but uneven shapes, muted photography" },
  { name: "Bold startup / colour-block", mood: "energetic product launch",
    palette: "one dominant brand colour used as full-section backgrounds (e.g. #4f46e5, #ff5a1f or #00a676) + white + black",
    type: "a tight, heavy grotesk (Inter Display 800, 'Unbounded', 'Sora')",
    layout: "full-width colour-block sections alternating, oversized product screenshot, logo wall, big stat numbers",
    details: "huge headline (8–10vw), sticky CTA, crisp UI screenshots with device frames, minimal decoration" },
  { name: "Playful illustrated", mood: "fun, approachable, for kids/creators/communities",
    palette: "bright primaries softened (tomato #ff6b6b, sun #ffd93d, sky #4d96ff, leaf #6bcb77) on white",
    type: "a rounded display (Baloo 2, Fredoka, 'Chewy' for accents) + Nunito",
    layout: "illustrated hero scene (inline SVG characters/shapes), wavy dividers, cards shaped like stickers",
    details: "bouncy hover animations, doodles, rotated badges, confetti/emoji accents in moderation" },
  { name: "Architectural mono", mood: "gallery / studio / portfolio — restrained and confident",
    palette: "concrete greys #e7e7e4 / #2b2b2b, black, white, no accent or one tiny one",
    type: "a wide or condensed sans (Archivo Narrow, 'Big Shoulders Display', 'Familjen Grotesk')",
    layout: "image-led grid with large index numbers, horizontal scroll gallery, project list as a table with hover previews",
    details: "cursor-follow image previews, uppercase small labels, no rounded corners, lots of negative space" },
  { name: "Y2K / chrome", mood: "nostalgic-futurist, music/fashion/events",
    palette: "silver chrome gradients, electric blue #2b59ff, hot pink #ff2bd6, black",
    type: "an extended/display face ('Syncopate', 'Michroma', 'Orbitron' for one line) + 'Inter' for text",
    layout: "centred poster-like hero, stacked lineup/schedule, sticker collage",
    details: "chrome/metallic text effects, star sparkles, pixel or wireframe grids, holographic gradients used once" },
];

const pick = (seed: string) => DIRECTIONS[parseInt(createHash("sha1").update(seed).digest("hex").slice(0, 8), 16) % DIRECTIONS.length];

/** The website brief, with this project's design direction. */
export function webDesignBrief(seed: string) {
  const d = pick(seed || "default");
  const others = DIRECTIONS.filter((x) => x !== d).map((x) => x.name).join(", ");
  return `
# Building websites and UIs — the quality bar
Deliver something that looks designed by a studio for THIS subject — not a template. Every site must look different from the last one you made.

## Design direction for this project: ${d.name}
- Mood: ${d.mood}
- Palette: ${d.palette}
- Type: ${d.type} (load from Google Fonts)
- Layout: ${d.layout}
- Signature details: ${d.details}
Rules: if the project already has a look (existing CSS, a design system, or a "Design direction" line in V.md), keep that instead. If this direction clearly doesn't suit the subject, pick the best fit from: ${others} — or invent one — and commit to it fully. Once chosen for a new site, save it with remember ("Design direction: <name> — palette …, fonts …") so later changes stay consistent.

## Avoid the generic AI look
Never default to: Inter + slate + an indigo/purple gradient hero; a centred hero with two buttons followed by three identical feature cards with icons; the same rounded-2xl card with a soft shadow everywhere; stock "glow blob" backgrounds; emoji as the only icons. Vary the hero (split, full-bleed image, typographic, collage, product-led), vary section shapes and rhythm, and only include sections the subject needs.

## Craft
- Stack: if the project already has one (React, Next, Vue, Tailwind…), use it. For a new site: a single index.html with Tailwind via its CDN (<script src="https://cdn.tailwindcss.com"></script>) configured with this direction's colours and fonts (tailwind.config in a <script>), and small vanilla JS.
- A real type scale and spacing system; contrast that passes WCAG AA; hover/focus states on everything clickable; a working mobile menu; fully responsive (check phone width: nothing overflows); semantic HTML, alt text, a <title> and favicon.
- Motion with taste: one or two meaningful animations (reveal on load, hover), respect prefers-reduced-motion.
- Images: real-looking imagery (https://images.unsplash.com/... with descriptive queries, or https://picsum.photos/seed/<word>/1200/800) or SVG illustration in the direction's style — never broken links or grey boxes.
- Copy: specific, confident copy for this exact product/person/business; invent plausible details rather than placeholders. No lorem ipsum, no "Feature 1".
- Then look at it: start it with run_app (static site: npx serve .) and call inspect_preview. Check the hero, spacing, alignment, mobile layout and console errors; fix what's off before you say you're done. Summarise what you built, the design direction, and how to open it.
`.trim();
}

/** Back-compat: the brief for the open project. */
export const WEB_DESIGN_BRIEF = webDesignBrief("default");
