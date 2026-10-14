'use client';

import { useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '../page-header';
import { Markdown } from '../chat/markdown';

interface SearchHit { title: string; url: string; snippet: string }
interface SearchResult { answer: string | null; hits: SearchHit[] }
interface ReadResult { title: string; url: string; text: string }

export function WebClient({ searchEnabled }: { searchEnabled: boolean }) {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="search · read"
        title="Bring the live web in."
        subtitle="Search the web for fresh facts, or turn any page into clean, readable text — no scraping, no clutter."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SearchPanel enabled={searchEnabled} />
        <ReadPanel />
      </div>
    </div>
  );
}

function SearchPanel({ enabled }: { enabled: boolean }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch('/api/web/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Search failed.');
    setResult(data as SearchResult);
  }

  return (
    <section className="tile card-pad flex flex-col gap-3">
      <div>
        <h2 className="h2 text-lg">Web search</h2>
        <p className="muted mt-0.5 text-sm">Powered by your free Tavily key.</p>
      </div>

      {!enabled && (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          Connect a free{' '}
          <Link href="/connect" className="font-medium text-[var(--brand)] hover:underline">Tavily key</Link>{' '}
          to search — 1,000 searches/month, no card.
        </p>
      )}

      <form onSubmit={run} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask the web something…"
          className="input flex-1"
          disabled={!enabled}
        />
        <button disabled={busy || !enabled || !query.trim()} className="btn btn-primary btn-sm shrink-0">
          {busy ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      {result && (
        <div className="space-y-3">
          {result.answer && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--brand-tint)] p-3 text-sm text-[var(--brand-ink)]">
              {result.answer}
            </div>
          )}
          <ul className="space-y-2.5">
            {result.hits.map((h) => (
              <li key={h.url}>
                <a href={h.url} target="_blank" rel="noreferrer" className="font-medium text-[var(--brand)] hover:underline">
                  {h.title}
                </a>
                <p className="muted mt-0.5 line-clamp-2 text-sm">{h.snippet}</p>
                <p className="faint truncate text-xs">{h.url}</p>
              </li>
            ))}
            {result.hits.length === 0 && <li className="muted text-sm">No results.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}

function ReadPanel() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReadResult | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch('/api/web/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? 'Could not read that URL.');
    setResult(data as ReadResult);
  }

  return (
    <section className="tile card-pad flex flex-col gap-3">
      <div>
        <h2 className="h2 text-lg">Read a URL</h2>
        <p className="muted mt-0.5 text-sm">Any page → clean text. Free, no key needed.</p>
      </div>

      <form onSubmit={run} className="flex gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="example.com/article"
          className="input flex-1"
        />
        <button disabled={busy || !url.trim()} className="btn btn-primary btn-sm shrink-0">
          {busy ? 'Reading…' : 'Read'}
        </button>
      </form>

      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

      {result && (
        <div className="space-y-2">
          <h3 className="font-semibold">{result.title}</h3>
          <div className="md max-h-[420px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
            <Markdown>{result.text || '*(empty page)*'}</Markdown>
          </div>
        </div>
      )}
    </section>
  );
}
