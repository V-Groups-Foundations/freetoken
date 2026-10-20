---
name: browser-game
description: "Build small browser games with HTML5 canvas (or Phaser 3 for bigger ones): game loop with requestAnimationFrame and delta time, keyboard/mouse/touch input, collision, game states (menu, play, pause, game over), score and localStorage high score, sound and mobile controls. Use when the user asks for a game, arcade clone (snake, pong, breakout, flappy, platformer, shooter) or anything interactive and playable."
---

# Browser game

A game is a loop: read input, update the world by elapsed time, draw. Keep state in plain objects and
make it feel good (responsive controls, feedback on every hit).

## 1. Choose the tech
- Small games (snake, pong, breakout, flappy, puzzles): one `index.html` with a `<canvas>` and vanilla JS.
- Bigger (sprites, tilemaps, physics, many scenes): Phaser 3,
  `<script src="https://cdn.jsdelivr.net/npm/phaser@3/dist/phaser.min.js"></script>` (npm: `phaser`).
- Card/board/turn-based games: plain DOM + CSS is often easier than canvas.

## 2. Canvas setup and loop (fixed logical size, scaled to fit, sharp on HiDPI)
```html
<canvas id="game"></canvas>
<style>html,body{margin:0;height:100%;background:#0b0f17;display:grid;place-items:center;overflow:hidden;touch-action:none}
canvas{max-width:100vw;max-height:100vh;aspect-ratio:16/9;width:min(100vw,calc(100vh*16/9))}</style>
<script>
const W = 960, H = 540, cv = document.getElementById('game'), ctx = cv.getContext('2d');
const dpr = Math.min(devicePixelRatio || 1, 2);
cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);

let state = 'menu', last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);   // seconds; clamp after tab switches
  last = now;
  if (state === 'play') update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
</script>
```
- Move by speed × dt (`player.x += player.vx * dt`, speeds in px/second) so it runs the same at 60 and 144Hz.
- For physics-heavy games use a fixed timestep (accumulate dt, step at 1/60s).
- Pause when the tab is hidden: `document.addEventListener('visibilitychange', ...)`.

## 3. Input
```js
const keys = new Set();
addEventListener('keydown', e => { keys.add(e.code); if (['Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault(); });
addEventListener('keyup', e => keys.delete(e.code));
// in update(): if (keys.has('ArrowLeft') || keys.has('KeyA')) player.vx = -300;
```
- Support arrows + WASD; Space/Enter to start; P or Escape to pause.
- Pointer events cover mouse and touch: `cv.addEventListener('pointerdown', ...)`. Convert to game
  coordinates: `x = (e.clientX - rect.left) * W / rect.width`.
- Mobile: on-screen buttons (min 56px) or swipe/drag controls; `touch-action:none` on the canvas;
  detect with `matchMedia('(pointer: coarse)')`.

## 4. Collision
- Axis-aligned boxes: `a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y`.
- Circles: `(dx*dx + dy*dy) < (r1 + r2) ** 2`.
- Resolve by pushing out along the smallest overlap axis; for fast objects, sub-step the movement.
- Hitboxes slightly smaller than sprites feel fairer.

## 5. States and structure
`menu` (title, controls, "Press Space"), `play`, `paused` (overlay), `over` (score, best, "Space to
restart"). One `reset()` that rebuilds all game state so restart is clean. Increase difficulty over time
(speed, spawn rate) with a cap.

## 6. Score and high score
```js
let best = 0; try { best = Number(localStorage.getItem('snake-best')) || 0; } catch {}
function gameOver() { state = 'over'; if (score > best) { best = score; try { localStorage.setItem('snake-best', best); } catch {} } }
```
Draw score with a clear font (`ctx.font = '600 28px system-ui'`), top-left or top-center.

## 7. Juice and sound
- Feedback: screen shake (2–6px for 150ms), particles on hits, a flash, easing on UI. Small, quick.
- Sound: Web Audio beeps need no files:
```js
let ac; function beep(f = 440, d = .08) { ac ??= new AudioContext(); const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.value = f; g.gain.setValueAtTime(.15, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + d);
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d); }
```
  Audio must start after a user gesture; add a mute toggle (M). Use Howler.js (`howler@2`) for audio files.
- Art: simple shapes with a cohesive palette look better than mismatched sprites.

## 8. Phaser 3 skeleton
```js
new Phaser.Game({ type: Phaser.AUTO, width: 960, height: 540, backgroundColor: '#0b0f17',
  physics: { default: 'arcade', arcade: { gravity: { y: 900 } } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: { preload() {}, create() { /* sprites, colliders, input */ }, update(time, delta) {} } });
```
Use separate Scene classes for Menu, Game and GameOver.

## Check before you finish
1. Open it (open_preview or run_app `npx serve .`) and inspect_preview: no console errors, menu renders.
2. Play a full round: start, score, die, restart; high score persists after reload.
3. Pause/resume works; game does not jump after switching tabs.
4. Check a mobile-width viewport: canvas fits, touch controls usable.
5. Tell the user the controls.

## Common mistakes
- Movement per frame instead of per second (speed depends on monitor refresh rate).
- `setInterval` loops; no dt clamp, so objects teleport after a tab switch.
- Restart that leaves old enemies or timers running.
- Blurry canvas (no devicePixelRatio scaling) or page scrolling when pressing arrow keys.
