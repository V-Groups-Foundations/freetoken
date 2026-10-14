'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

// Runs before paint (in layout <head>) so the first frame already has the right theme.
export const themeScript = `(function(){try{var t=localStorage.getItem('ft-theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

function current(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  }
  return 'light';
}

/** Flip the theme on the document + persist it. Returns the new theme. Usable anywhere. */
export function toggleTheme(): Theme {
  const next: Theme = current() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('ft-theme', next);
  } catch {
    /* ignore */
  }
  return next;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  const [ready, setReady] = useState(false);

  // Defer the first setState so it isn't a synchronous setState in the effect body.
  useEffect(() => {
    const t = setTimeout(() => {
      setTheme(current());
      setReady(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  function toggle() {
    setTheme(toggleTheme());
  }

  return (
    <button
      onClick={toggle}
      className="btn btn-ghost btn-sm"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {ready ? (theme === 'dark' ? '☀' : '☾') : '☾'}
    </button>
  );
}
