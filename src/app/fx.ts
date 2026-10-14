// Tiny, dependency-free UI flourishes: a toast and a confetti burst.
// Both no-op safely on the server and respect reduced-motion.

const REDUCED = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function toast(message: string) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.setAttribute('role', 'status');
  el.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:28px', 'transform:translateX(-50%) translateY(8px)',
    'background:var(--ink)', 'color:var(--bg)', 'padding:10px 16px', 'border-radius:999px',
    'font-size:13px', 'font-weight:600', 'z-index:9999', 'box-shadow:var(--shadow-md)',
    'opacity:0', 'transition:opacity .2s ease, transform .2s ease', 'pointer-events:none',
  ].join(';');
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(8px)';
    setTimeout(() => el.remove(), 250);
  }, 1900);
}

const COLORS = ['#2dd4bf', '#06b6d4', '#3b82f6', '#f59e0b', '#22c55e'];

// A short confetti burst centered on an element (or the viewport center).
export function confetti(origin?: HTMLElement | null) {
  if (typeof document === 'undefined' || REDUCED()) return;
  const rect = origin?.getBoundingClientRect();
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 3;

  for (let i = 0; i < 26; i++) {
    const p = document.createElement('div');
    const size = 6 + Math.random() * 6;
    p.style.cssText = [
      'position:fixed', `left:${cx}px`, `top:${cy}px`, `width:${size}px`, `height:${size}px`,
      `background:${COLORS[i % COLORS.length]}`, 'border-radius:2px', 'z-index:9999',
      'pointer-events:none', 'will-change:transform,opacity',
    ].join(';');
    document.body.appendChild(p);

    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 120;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 40; // bias upward
    p.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy + 160}px) rotate(${Math.random() * 540}deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.3,1)' },
    ).onfinish = () => p.remove();
  }
}
