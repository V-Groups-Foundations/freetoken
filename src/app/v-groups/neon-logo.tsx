'use client';

import { useEffect, useRef, useState } from 'react';

export type Colorway = { src: string; name: string; filter?: string; glow: string };

/**
 * The V Groups logo as a neon sign that switches colourways: the lights dip off, then flicker back on
 * in the next combination, with a matching glow behind. Click to switch now. With reduced motion it
 * simply shows the first colourway.
 */
export function NeonLogo({ colorways, every = 3600 }: { colorways: Colorway[]; every?: number }) {
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'on' | 'off' | 'flicker'>('on');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const n = colorways.length;

  // preload user-supplied files so a switch never shows a half-loaded image
  useEffect(() => { for (const c of colorways) { const img = new Image(); img.src = c.src; } }, [colorways]);

  const switchTo = (next: (x: number) => number) => {
    timers.current.forEach(clearTimeout);
    setPhase('off');
    timers.current = [
      setTimeout(() => { setI((x) => next(x) % n); setPhase('flicker'); }, 320),
      setTimeout(() => setPhase('on'), 320 + 900),
    ];
  };

  useEffect(() => {
    if (n < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => switchTo((x) => x + 1), every);
    return () => { clearInterval(id); timers.current.forEach(clearTimeout); };
  }, [n, every]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = colorways[i];
  return (
    <div className="neon-logo" data-phase={phase} style={{ ['--glow' as string]: c.glow }}
      onClick={() => n > 1 && switchTo((x) => x + 1)} role="img" aria-label={`V Groups logo — ${c.name}`}>
      <div className="neon-logo-halo" aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element -- brand art, swapped per colourway */}
      <img src={c.src} alt="" width={1408} height={768} style={{ filter: c.filter }} draggable={false} />
      {n > 1 && (
        <div className="neon-logo-dots" aria-hidden>
          {colorways.map((cw, j) => <span key={cw.name} data-on={j === i} style={{ background: cw.glow }} title={cw.name} />)}
        </div>
      )}
    </div>
  );
}
