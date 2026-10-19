import Link from 'next/link';
import { OpenVRun } from '../v-run/launch';

/** The V Groups family: FreeToken (this site) and V-Run (the desktop coding app). */
export default function VGroupsPage() {
  return (
    <section className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] shadow-[0_20px_60px_#0006]">
        {/* eslint-disable-next-line @next/next/no-img-element -- brand art */}
        <img src="/brand/vgroups.jpg" alt="V Groups" width={1408} height={768} className="block h-auto w-full" />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-6 text-sm text-white/80">
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
