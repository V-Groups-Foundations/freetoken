import { readdirSync } from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { OpenVRun } from '../v-run/launch';
import { NeonLogo, type Colorway } from './neon-logo';
import './neon-logo.css';

/**
 * Colourways for the neon logo. Drop your own versions of the logo (png/jpg/webp, same framing) into
 * public/brand/vgroups-variants/ and they're used in filename order; until then, colour-shifted
 * versions of the original stand in.
 */
function colorways(): Colorway[] {
  try {
    const dir = path.join(process.cwd(), 'public', 'brand', 'vgroups-variants');
    const files = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp|avif)$/i.test(f)).sort();
    const glows = ['#38d6ff', '#c084fc', '#34d399', '#fb923c', '#f472b6', '#e0f2fe'];
    if (files.length) return files.map((f, i) => ({ src: `/brand/vgroups-variants/${f}`, name: f.replace(/\.[^.]+$/, ''), glow: glows[i % glows.length] }));
  } catch { /* no folder: use the generated colourways */ }
  const src = '/brand/vgroups.jpg';
  return [
    { src, name: 'Original', glow: '#38d6ff' },
    { src, name: 'Magenta', filter: 'hue-rotate(55deg) saturate(1.15)', glow: '#e879f9' },
    { src, name: 'Emerald', filter: 'hue-rotate(-55deg) saturate(1.1)', glow: '#34d399' },
    { src, name: 'Sunset', filter: 'hue-rotate(150deg) saturate(1.25)', glow: '#fb923c' },
    { src, name: 'Ice', filter: 'saturate(0.35) brightness(1.2)', glow: '#e0f2fe' },
  ];
}

/** The V Groups family: FreeToken (this site) and V-Run (the desktop coding app). */
export default function VGroupsPage() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] shadow-[0_20px_60px_#0006]">
        <NeonLogo colorways={colorways()} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/80 to-transparent p-6 text-sm text-white/80">
          Free AI tools that work together — build it for free, use it for free.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card card-pad flex flex-col gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand mark */}
            <img src="/brand/freetoken.png" alt="" width={48} height={48} className="h-12 w-12 rounded-xl" />
            <div>
              <div className="text-lg font-semibold">FreeToken</div>
              <div className="muted text-sm">Every free AI model, one key — you are here</div>
            </div>
          </div>
          <p className="muted text-sm">Pools your free AI quotas into one chat, one OpenAI-compatible API and one terminal, and powers V-Run.</p>
          <div className="mt-auto flex gap-2">
            <Link href="/chat" className="btn btn-secondary">Open Chat</Link>
            <Link href="/connect" className="btn btn-ghost">Connect providers</Link>
          </div>
        </div>

        <div className="card card-pad flex flex-col gap-3 border-[color-mix(in_srgb,var(--brand)_45%,var(--border))]">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand art */}
            <img src="/brand/vrun.jpg" alt="" width={86} height={48} className="h-12 w-[86px] rounded-xl object-cover" />
            <div>
              <div className="text-lg font-semibold">V-Run</div>
              <div className="muted text-sm">The desktop coding app — build it for free, use it for free</div>
            </div>
          </div>
          <p className="muted text-sm">An editor with an agent that writes your code, runs your app and fixes what it sees — continuing any FreeToken project with its whole conversation.</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <OpenVRun />
            <Link href="/v-run" className="btn btn-secondary">V-Run projects</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
