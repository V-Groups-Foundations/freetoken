'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Project = { id: string; name: string };

export function ProjectList({ initial }: { initial: Project[] }) {
  const router = useRouter();
  const [projects, setProjects] = useState(initial);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    setBusy(false);
    if (!res.ok) return;
    const p = await res.json();
    router.push(`/projects/${p.id}`);
  }

  async function remove(id: string) {
    await fetch(`/api/projects?id=${id}`, { method: 'DELETE' });
    setProjects((ps) => ps.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          className="flex-1 rounded-lg border border-[#e3e6ee] bg-white px-3 py-2 text-sm focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/20"
        />
        <button disabled={busy || !name.trim()} className="rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
          Create
        </button>
      </form>

      {projects.length === 0 ? (
        <p className="text-sm text-neutral-500">No projects yet. Create one to start a shared chat-and-terminal workspace.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-xl border border-[#e3e6ee] bg-white p-4">
              <Link href={`/projects/${p.id}`} className="font-medium text-[#232a3b] hover:underline">
                {p.name}
              </Link>
              <button onClick={() => remove(p.id)} className="text-sm text-red-700 hover:underline">Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
