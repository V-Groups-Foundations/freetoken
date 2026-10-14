import type { ReactNode } from 'react';

// Shared page hero: an aurora glow backdrop + gradient title, matching the Connect page.
// Presentational only (no hooks), so both server and client pages can use it.
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="grid-bg relative">
      <div className="aurora" aria-hidden />
      <header className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h1 className={`display text-[2rem] font-bold leading-[1.05] tracking-tight text-[var(--ink)] ${eyebrow ? 'mt-2.5' : ''}`}>{title}</h1>
          {subtitle && <p className="muted mt-1.5 max-w-2xl text-sm leading-relaxed">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>
    </div>
  );
}
