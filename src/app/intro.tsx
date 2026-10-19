'use client';

import { useEffect, useState } from 'react';
import './intro.css';

/**
 * "V Groups presents FreeToken" — the opening title card, once per browser session. It is rendered on
 * the server so it covers the page before first paint; `introScript` (run in <head>) hides it straight
 * away when it was already shown this session, or when the page is open inside V-Run (which plays its
 * own intro). Click, Esc or any key skips it.
 */
export const introScript = `try{if(sessionStorage.getItem('vg-intro')||window.vrun)document.documentElement.classList.add('vg-seen')}catch(e){}`;

const DURATION = 7800;

export function Intro() {
  const [state, setState] = useState<'play' | 'leave' | 'gone'>('play');

  // Only a *playing* intro can be skipped: the key listener lives exactly as long as that state, and
  // "skip" never brings back an intro that has already left (that was the half-second flash on the
  // first key press after the intro had ended by itself).
  const leave = () => setState((s) => (s === 'play' ? 'leave' : s));

  useEffect(() => {
    if (state !== 'play') return;
    if (document.documentElement.classList.contains('vg-seen')) {
      const t = setTimeout(() => setState('gone'), 0);
      return () => clearTimeout(t);
    }
    try { sessionStorage.setItem('vg-intro', '1'); } catch { /* private mode */ }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // the CSS timeline began at first paint, before hydration: count from there, not from now
    const begun = Number(document.querySelector('.vg-art')?.getAnimations()[0]?.currentTime ?? 0) || 0;
    const t = setTimeout(leave, Math.max(0, (reduce ? 1500 : DURATION - 700) - begun));
    window.addEventListener('keydown', leave);
    return () => { clearTimeout(t); window.removeEventListener('keydown', leave); };
  }, [state]);

  useEffect(() => {
    if (state !== 'leave') return;
    const t = setTimeout(() => setState('gone'), 700);
    return () => clearTimeout(t);
  }, [state]);

  if (state === 'gone') return null;
  return (
    <div className={`vg-intro${state === 'leave' ? ' vg-leave' : ''}`} role="presentation" onClick={leave}>
      <div className="vg-stage vg-group">
        {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed brand art, not an optimizable photo */}
        <img src="/brand/vgroups.jpg" alt="" className="vg-art" />
        <div className="vg-sweep" />
        <div className="vg-presents">presents</div>
      </div>
      <div className="vg-stage vg-product">
        <div className="vg-glow" />
        {/* eslint-disable-next-line @next/next/no-img-element -- brand mark */}
        <img src="/brand/freetoken.png" alt="" className="vg-mark" />
        <div className="vg-name">FreeToken</div>
        <div className="vg-tag">Every free AI model · one key</div>
      </div>
      <button className="vg-skip" onClick={(e) => { e.stopPropagation(); leave(); }}>Skip intro</button>
      <span className="sr-only">V Groups presents FreeToken</span>
    </div>
  );
}
