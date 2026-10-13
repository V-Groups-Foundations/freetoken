import Link from 'next/link';

const PROVIDERS = [
  { name: 'Gemini', color: '#1a73e8' },
  { name: 'Groq', color: '#f55036' },
  { name: 'OpenRouter', color: '#6467f2' },
  { name: 'Cloudflare', color: '#f38020' },
  { name: 'Cerebras', color: '#d97706' },
  { name: 'Mistral', color: '#fa520f' },
  { name: 'GitHub', color: '#2b3137' },
];

export default function Home() {
  return (
    <div className="space-y-20 py-6">
      <section className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <span className="badge badge-ok">Bring your own free API keys</span>
          <h1 className="h1">All your free AI quotas, pooled into one.</h1>
          <p className="lead max-w-xl">
            Connect the free tiers you already have — Gemini, Groq, OpenRouter and more. FreeToken sends
            each request to whichever of your providers still has quota, and gives you one chat, one
            OpenAI-compatible API, and one terminal.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/connect" className="btn btn-primary">Connect your providers</Link>
            <Link href="/projects" className="btn btn-secondary">Open a project</Link>
          </div>
          <p className="faint text-sm">Keys are encrypted and only ever used for your own requests.</p>
        </div>

        <div className="card card-pad">
          <div className="text-sm font-medium muted">Your providers</div>
          <div className="mt-4 space-y-2.5">
            {PROVIDERS.map((p) => (
              <div key={p.name} className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                <span className="text-sm">{p.name}</span>
                <span className="ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-[var(--surface-2)]">
                  <span className="block h-full rounded-full" style={{ width: '62%', backgroundColor: p.color, opacity: 0.55 }} />
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between rounded-xl bg-[var(--brand-tint)] px-4 py-3">
            <span className="text-sm font-medium text-[var(--brand-ink)]">Routed as one pool</span>
            <span className="font-mono text-xs text-[var(--brand-ink)]">auto‑smart</span>
          </div>
        </div>
      </section>

      <section className="grid gap-5 sm:grid-cols-3">
        {[
          { t: 'Automatic routing', d: 'Each request goes to a provider with free quota left, and falls back the moment one is rate-limited.' },
          { t: 'One API & terminal', d: 'A personal OpenAI-compatible endpoint plus a terminal client — point any tool at your pool.' },
          { t: 'Projects that remember', d: 'A project keeps one conversation that the chat, the web terminal, and your desktop all share.' },
        ].map((f) => (
          <div key={f.t} className="card card-pad">
            <h3 className="font-semibold">{f.t}</h3>
            <p className="muted mt-1.5 text-sm leading-relaxed">{f.d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
