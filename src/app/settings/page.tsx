import { headers } from 'next/headers';
import { requireUserId } from '@/lib/session';
import { PageHeader } from '../page-header';
import { Tokens } from './tokens';
import { GUIDES, setupText } from '@/cli/integrations.mjs';

export default async function SettingsPage() {
  await requireUserId();
  const h = await headers();
  const proto = h.get('x-forwarded-proto') ?? 'http';
  const baseUrl = `${proto}://${h.get('host')}/api/v1`;
  return (
    <section className="space-y-6">
      <PageHeader
        title="Your API"
        subtitle="Use FreeToken from Claude Code, Cursor, Cline, Continue, Aider or your own scripts — OpenAI- and Anthropic-compatible."
      />
      <div className="card card-pad space-y-1.5 text-sm">
        <div>Base URL <code className="ml-1 rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">{baseUrl}</code></div>
        <div>Anthropic base URL <span className="muted">(Claude Code, Anthropic SDKs)</span> <code className="ml-1 rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">{baseUrl.replace(/\/v1$/, '')}</code></div>
        <div>Models <code className="ml-1 rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">auto-smart</code> <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">auto-fast</code> <span className="muted">or any from</span> <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-xs">/models</code></div>
      </div>
      <Tokens />
      <div id="tools" className="card card-pad scroll-mt-6 space-y-4">
        <div>
          <span className="eyebrow">use it everywhere</span>
          <h2 className="h2 mt-2">Run your favourite AI tools on your free models</h2>
          <p className="muted mt-1 text-sm">Create a token above, then pick your tool. From a terminal, <code className="font-mono text-xs">freetoken run &lt;tool&gt;</code> sets everything up for that run; <code className="font-mono text-xs">freetoken setup &lt;tool&gt;</code> prints this.</p>
        </div>
        <div className="grid items-start gap-3 md:grid-cols-2">
          {Object.entries(GUIDES).map(([id, g]) => (
            <details key={id} className="tile p-4" open={id === 'claude-code'}>
              <summary className="cursor-pointer font-semibold">{g.name}</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[var(--bg-deep)] p-3 font-mono text-xs text-[var(--muted)]">{setupText(id, baseUrl, '<your ft_ token>').split('\n').slice(1).map((l) => l.replace(/^  /, '')).join('\n')}</pre>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
