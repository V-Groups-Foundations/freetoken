'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toggleTheme } from './theme-toggle';

type Item = { label: string; icon: string; hint?: string; run: (r: ReturnType<typeof useRouter>) => void };

const go = (href: string) => (r: ReturnType<typeof useRouter>) => r.push(href);

const ITEMS: Item[] = [
  { label: 'New chat', icon: '✨', hint: 'Start a conversation', run: go('/chat') },
  { label: 'Chat', icon: '💬', run: go('/chat') },
  { label: 'Image studio', icon: '🎨', hint: 'Generate an image', run: go('/images') },
  { label: 'Documents', icon: '📄', hint: 'Chat with your files', run: go('/docs') },
  { label: 'Web', icon: '🌐', hint: 'Search · read any URL', run: go('/web') },
  { label: 'Mini-app studio', icon: '🕹️', hint: 'Build a game or app', run: go('/studio') },
  { label: 'Tools', icon: '🛠️', hint: 'Extract · translate · summarize', run: go('/tools') },
  { label: 'Connect providers', icon: '🔌', run: go('/connect') },
  { label: 'V-Run projects', icon: '▶', run: go('/v-run') },
  { label: 'V Groups', icon: '✦', run: go('/v-groups') },
  { label: 'Usage', icon: '📊', hint: 'Free quota left', run: go('/dashboard') },
  { label: 'API keys', icon: '🔑', run: go('/settings') },
  { label: 'Toggle theme', icon: '◐', hint: 'Light / dark', run: () => toggleTheme() },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? ITEMS.filter((it) => (it.label + ' ' + (it.hint ?? '')).toLowerCase().includes(query.trim().toLowerCase()))
    : ITEMS;

  // Global ⌘K / Ctrl+K to toggle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery('');
        setActive(0);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus the field when the palette opens (focus() is not a state update).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function choose(item: Item | undefined) {
    if (!item) return;
    setOpen(false);
    item.run(router);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(filtered[active]); }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setQuery(''); setActive(0); }}
        className="rail-link w-full"
        title="Command palette (⌘K)"
      >
        <span className="rail-ico" aria-hidden>⌘</span>
        <span className="hidden flex-1 text-left md:inline">Search</span>
        <kbd className="kbd hidden md:inline">⌘K</kbd>
      </button>

      {open && (
        <div className="cmd-backdrop" onClick={() => setOpen(false)}>
          <div className="cmd-panel" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
              <span className="faint" aria-hidden>⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onInputKey}
                placeholder="Jump to… or run a command"
                className="w-full bg-transparent text-[15px] text-[var(--ink)] placeholder:text-[var(--faint)] focus:outline-none"
              />
              <kbd className="kbd">esc</kbd>
            </div>
            <ul className="max-h-[320px] overflow-y-auto p-2">
              {filtered.length === 0 && <li className="faint px-3 py-6 text-center text-sm">No matches</li>}
              {filtered.map((it, i) => (
                <li key={it.label}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(it)}
                    data-active={i === active}
                    className="cmd-item"
                  >
                    <span className="cmd-ico" aria-hidden>{it.icon}</span>
                    <span className="flex-1 text-left">{it.label}</span>
                    {it.hint && <span className="faint hidden text-xs sm:inline">{it.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--faint)]">
              <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
              <span><kbd className="kbd">↵</kbd> open</span>
              <span><kbd className="kbd">esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
