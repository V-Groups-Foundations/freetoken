// Skills that ship with V-Run. A skill of the same name in ~/.v-run/skills or the project replaces one.

export const BUILTIN_SKILLS: { name: string; description: string; body: string }[] = [
  {
    name: "html-video",
    description: "Make a video as an animated HTML page — explainers, product promos, intros, title sequences, animated charts, social clips — and export it to an MP4 file. Use whenever the user asks for a video, animation, motion graphics, intro or trailer.",
    body: `# HTML video

A video here is one self-contained HTML file that plays like a film: a fixed 16:9 stage, scenes on a
timeline, and motion driven by time. It previews live in V-Run, and export_video renders it frame by
frame into an MP4 (time is virtual during export, so it is smooth however heavy the page is).

## 1. Plan before you write
Write a short shot list first (in your reply, not a file): total length (usually 8–30 s), and each scene
with start–end time, what is on screen, what moves and the text. 3–6 scenes. One idea per scene, big
type, few words (a viewer reads ~3 words per second). End on a clear final frame (logo, call to action).

## 2. The file
- \`video/index.html\` (or the name the user wants), everything inline; Google Fonts and images by URL are fine.
- The stage: a 1920×1080 element scaled to fit the window with CSS (letterboxed on black), so it previews
  at any size and exports at full size:
  \`\`\`html
  <div id="stage"> …scenes… </div>
  <style>
    html,body{margin:0;height:100%;background:#000;overflow:hidden}
    #stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center;
           transform:translate(-50%,-50%) scale(var(--fit,1));overflow:hidden}
  </style>
  <script>
    const fit=()=>document.documentElement.style.setProperty('--fit',Math.min(innerWidth/1920,innerHeight/1080));
    addEventListener('resize',fit);fit();
  </script>
  \`\`\`
- Declare the length: \`window.__video = { duration: 12 };\` (seconds). Export reads it.

## 3. Animate with time, not events
Use ONE of these (both export perfectly):
- **CSS animations with delays** on a shared clock: every element animates from page load, its scene
  start is its \`animation-delay\`; use \`animation-fill-mode: both\`. Example:
  \`.s2-title{animation:rise .8s cubic-bezier(.2,.8,.2,1) 4.2s both}\`.
  Scenes appear/disappear with opacity/clip-path/transform keyframes at the right delays.
- **A render(t) function** for anything computed (counters, charts, canvas, particles):
  \`\`\`js
  window.__video = { duration: 12, render(t){ /* set every element from t (seconds) */ } };
  const t0 = performance.now();
  (function loop(){ __video.render((performance.now()-t0)/1000 % __video.duration); requestAnimationFrame(loop); })();
  \`\`\`
  Export calls \`render(t)\` itself for each frame. Make render a pure function of t (no accumulated state).
Do not trigger animation on scroll, hover or click. setTimeout/setInterval also work (time is virtual
during export), but prefer the two methods above.

## 4. Make it look like real motion design
- A deliberate look: pick a palette (2 colours + neutrals) and a type pairing that fits the subject;
  a different look for each video. Large display type (120–220px headlines), tight tracking, real hierarchy.
- Motion with intent: ease-out for entrances (cubic-bezier(.2,.8,.2,1)), 0.5–0.9 s; stagger related
  items by 60–120 ms; move things 40–120 px, not across the screen; mask/clip reveals for text;
  one hero motion per scene; hold each scene long enough to read; transitions that connect scenes
  (wipe, scale-through, shared element) rather than hard cuts everywhere.
- Depth and texture: layered backgrounds, soft gradients, grain or subtle shapes; nothing static for long.
- No audio (exports are silent). No lorem ipsum.

## 5. Check, then export
1. Preview it: open the file with open_preview (file path) or run_app \`npx serve .\`, and use inspect_preview;
   fix overflow, clipped text, console errors.
2. Export with export_video (path to the HTML file). It writes an MP4 next to it (1920×1080, 30 fps)
   and reports the size. Tell the user where the file is.
`,
  },
];
