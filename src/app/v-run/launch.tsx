'use client';

import { useState, useSyncExternalStore } from 'react';
import { toast } from '../fx';

// Handing things to the V-Run desktop app. Inside V-Run the page talks to it through window.vrun (its
// bridge); in a browser it follows a vrun:// link, which V-Run registers the first time it runs.

const noSubscribe = () => () => {};
/** True when this page is shown inside V-Run. The bridge exists from page load and never changes. */
export const useInVRun = () => useSyncExternalStore(noSubscribe, () => !!window.vrun, () => false);

type Phase = 'idle' | 'opening' | 'help';

function useLauncher() {
  const [phase, setPhase] = useState<Phase>('idle');
  /** Follow a vrun:// link; if the browser is still here a moment later, nothing handled it. */
  function viaLink(href: string) {
    setPhase('opening');
    window.location.href = href;
    setTimeout(() => setPhase((p) => (p === 'opening' ? 'help' : p)), 1800);
  }
  return { phase, setPhase, viaLink };
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div role="status" className="absolute left-0 top-full z-20 mt-2 w-80 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm shadow-lg">
      <div className="font-medium text-[var(--ink)]">V-Run didn&apos;t open?</div>
      <p className="mt-1 text-[var(--muted)]">
        Start it once so it can register itself, then click again. From the FreeToken folder run{' '}
        <code className="rounded bg-[var(--surface-2)] px-1 font-mono text-xs">npm run desktop</code>.
      </p>
      <button onClick={onClose} className="mt-2 text-xs text-[var(--muted)] underline">Dismiss</button>
    </div>
  );
}

const PRIMARY = 'inline-flex items-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[var(--brand-ink)] disabled:opacity-50';

/** Bring up the V-Run desktop app (launching it if needed). */
export function OpenVRun({ label = 'Open V-Run', className = PRIMARY }: { label?: string; className?: string }) {
  const inVRun = useInVRun();
  const { phase, setPhase, viaLink } = useLauncher();
  async function go() {
    if (window.vrun) { await window.vrun.focus().catch(() => {}); return; }
    viaLink('vrun://open');
  }
  return (
    <div className="relative inline-block">
      <button onClick={go} disabled={phase === 'opening'} className={className} title={inVRun ? 'Back to the editor' : 'Launch the V-Run desktop app'}>
        <span aria-hidden>▶</span>{phase === 'opening' ? 'Opening V-Run…' : inVRun ? 'Back to V-Run' : label}
      </button>
      {phase === 'help' && <Help onClose={() => setPhase('idle')} />}
    </div>
  );
}

/**
 * Hand a project to V-Run: it opens the project's folder (Desktop/FreeToken/<name>) and continues this
 * exact conversation in its agent chat; its turns are written back here.
 */
export function ContinueInVRun({ projectId, projectName, disabled, big }: { projectId: string; projectName: string; disabled?: boolean; big?: boolean }) {
  const inVRun = useInVRun();
  const { phase, setPhase, viaLink } = useLauncher();
  async function go() {
    if (window.vrun) {
      setPhase('opening');
      try { await window.vrun.openProject(projectId); toast(`Opened ${projectName} in V-Run`); }
      catch (e) { toast(e instanceof Error ? e.message : 'V-Run could not open the project'); }
      setPhase('idle');
      return;
    }
    viaLink(`vrun://project/${encodeURIComponent(projectId)}`);
  }
  return (
    <div className="relative inline-block">
      <button onClick={go} disabled={disabled || phase === 'opening'} className={big ? `${PRIMARY} px-6 py-3 text-base` : PRIMARY}
        title="Open this project's folder in V-Run and keep going with its coding agent — the whole conversation comes along">
        <span aria-hidden>▶</span>{phase === 'opening' ? 'Opening V-Run…' : inVRun ? 'Open this project in V-Run' : 'Continue in V-Run'}
      </button>
      {phase === 'help' && <Help onClose={() => setPhase('idle')} />}
    </div>
  );
}
