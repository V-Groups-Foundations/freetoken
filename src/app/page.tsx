import Link from 'next/link';

const PROVIDERS = [
  { name: 'Gemini', color: '#1a73e8', fill: '72%' },
  { name: 'Groq', color: '#f55036', fill: '58%' },
  { name: 'OpenRouter', color: '#6467f2', fill: '41%' },
  { name: 'NVIDIA NIM', color: '#76b900', fill: '66%' },
  { name: 'Cohere', color: '#d18ee2', fill: '30%' },
];

const FEATURES = [
  { icon: '🔀', t: 'One key, every free model', d: 'Each request goes to a provider with free quota left and falls back the moment one is rate-limited — Gemini, Groq, OpenRouter, NVIDIA, Cohere, GitHub Models and more.' },
  { icon: '⌘', t: 'Claude Code, Cursor & Cline — free', d: 'An OpenAI- and Anthropic-compatible API. “freetoken run claude” starts Claude Code on your free models; Cursor, Cline and Continue take a base URL.' },
  { icon: '▶', t: 'V-Run, the desktop agent', d: 'Plan a project in chat, then continue it in V-Run — an AI code editor that writes your code, runs your app and fixes what it sees.' },
  { icon: '⚡', t: 'Works in a minute', d: 'One-line install, signed in automatically, and a built-in starter model so you can chat before adding a single key.' },
  { icon: '🔒', t: 'Yours, on your machine', d: 'Self-hosted and open source. Keys are encrypted with your own secret and only ever sent to the provider they belong to.' },
  { icon: '$0', t: 'Free, for good', d: 'No subscription, no card, no markup — FreeToken just makes the free tiers you already have work as one.' },
];

export default function Home() {
  return (
    <div className="space-y-20 py-6">
      <section className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- brand mark */}
            <img src="/brand/freetoken.png" alt="" width={56} height={56} className="mark-glow h-14 w-14 rounded-2xl" />
            <span className="eyebrow">free ai tokens · by v groups</span>
          </div>
          <h1 className="h1">Every free AI model,<br /><span className="grad-text">one key.</span></h1>
          <p className="lead max-w-xl">
            FreeToken pools the free tiers of Gemini, Groq, OpenRouter, NVIDIA and more into one chat, one
            OpenAI- and Anthropic-compatible API — and V-Run, a desktop coding agent. Run Claude Code, Cursor or
            Cline on it. Pay nothing.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/connect" className="btn btn-primary">Get started — free</Link>
            <Link href="/v-run" className="btn btn-secondary">▶ Open V-Run</Link>
          </div>
          <p className="faint text-sm">Self-hosted · open source · keys encrypted and used only for your own requests.</p>
        </div>

        <div className="relative">
          <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[40px] opacity-70 blur-3xl" style={{ background: 'radial-gradient(50% 50% at 75% 15%, color-mix(in srgb, var(--teal) 38%, transparent), transparent), radial-gradient(50% 50% at 20% 90%, color-mix(in srgb, var(--blue) 34%, transparent), transparent)' }} />
          {/* a terminal running Claude Code on free models */}
          <div className="neon-frame overflow-hidden rounded-2xl border border-[var(--border)] bg-[#050812]/90 font-mono text-[13px] leading-relaxed">
            <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" /><span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" /><span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <span className="ml-2 text-xs text-[var(--faint)]">~/my-app</span>
            </div>
            <div className="space-y-1 px-4 py-3.5 text-[#cfe3ff]">
              <div><span className="text-[#5eead4]">$</span> freetoken run claude</div>
              <div className="text-[var(--faint)]">◆ claude → FreeToken · free models · auto-smart</div>
              <div><span className="text-[#a78bfa]">&gt;</span> build a landing page for my bakery and run it</div>
              <div className="text-[#8be9ff]">⏺ Write(index.html) <span className="text-[var(--faint)]">+142 lines</span></div>
              <div className="text-[#8be9ff]">⏺ Bash(npx serve .) <span className="text-[var(--faint)]">→ localhost:3000</span></div>
              <div className="text-[#34d399]">✓ Done in 41s · cost $0.00</div>
            </div>
          </div>
          <div className="card card-pad mt-4">
            <div className="flex items-center justify-between text-sm"><span className="font-medium muted">Your free pool</span><span className="font-mono text-xs text-[var(--brand-ink)]">auto-smart</span></div>
            <div className="mt-3 space-y-2">
              {PROVIDERS.map((p) => (
                <div key={p.name} className="flex items-center gap-3">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color, boxShadow: `0 0 8px ${p.color}` }} />
                  <span className="w-24 text-sm">{p.name}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <span className="block h-full rounded-full" style={{ width: p.fill, background: 'var(--grad)' }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-5">
        <div>
          <span className="eyebrow">why freetoken</span>
          <h2 className="h2 mt-2.5">Everything the paid tools do — on the free tiers you already have.</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.t} className="tile card-pad">
              <div className="grid h-10 w-10 place-items-center rounded-xl text-lg font-semibold" style={{ background: 'var(--brand-tint)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent)' }}>{f.icon}</div>
              <h3 className="mt-3 font-semibold">{f.t}</h3>
              <p className="muted mt-1.5 text-sm leading-relaxed">{f.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="neon-frame relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--glass)] p-8 text-center">
        <div className="aurora" aria-hidden />
        <h2 className="h2">Start in one line.</h2>
        <p className="muted mx-auto mt-2 max-w-xl text-sm">Installs, sets itself up and opens signed in — chat works before you add a single key.</p>
        <div className="mx-auto mt-5 max-w-2xl space-y-2 text-left font-mono text-xs">
          <div className="rounded-xl border border-[var(--border)] bg-[#050812]/80 px-4 py-3"><span className="text-[var(--faint)]">Windows · </span>irm https://raw.githubusercontent.com/V-Groups-Foundations/freetoken/master/install.ps1 | iex</div>
          <div className="rounded-xl border border-[var(--border)] bg-[#050812]/80 px-4 py-3"><span className="text-[var(--faint)]">macOS / Linux · </span>curl -fsSL https://raw.githubusercontent.com/V-Groups-Foundations/freetoken/master/install.sh | bash</div>
        </div>
        <div className="mt-5 flex justify-center gap-3">
          <Link href="/connect" className="btn btn-primary">Add free keys</Link>
          <a href="https://github.com/V-Groups-Foundations/freetoken" className="btn btn-secondary">★ Star on GitHub</a>
        </div>
      </section>

      <footer className="flex items-center justify-center gap-2 pb-2 pt-4 text-xs text-[var(--faint)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- brand art */}
        <img src="/brand/vgroups.jpg" alt="" width={44} height={24} className="h-6 w-11 rounded object-cover opacity-80" />
        FreeToken and V-Run are V Groups products
      </footer>
    </div>
  );
}
