'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from '../fx';

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
    }).catch(() => null);
    setBusy(false);
    // never a silent no-op: say why it wasn't created
    if (!res) return toast("Couldn't reach FreeToken — is it still running?");
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error ?? "Couldn't create the project — try again.");
    const p = await res.json();
    router.push(`/projects/${p.id}`);
  }

  async function remove(id: string) {
    const ok = await fetch(`/api/projects?id=${id}`, { method: 'DELETE' }).then((r) => r.ok, () => false);
    if (!ok) return toast("Couldn't delete the project — try again."); // it's still there: keep showing it
    setProjects((ps) => ps.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name" className="input flex-1" />
        <button disabled={busy || !name.trim()} className="btn btn-primary">Create</button>
      </form>

      {projects.length === 0 ? (
        <div className="card card-pad flex flex-col items-center gap-2 py-12 text-center">
          <div className="grad flex h-12 w-12 items-center justify-center rounded-2xl text-xl text-white shadow-[var(--shadow-brand)]">✦</div>
          <h3 className="font-semibold">Start your first project</h3>
          <p className="muted max-w-sm text-sm">
            A project is one conversation you can start here and continue in V-Run, the desktop coding app,
            inside its own folder. Name it above to begin.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id} className="card flex items-center justify-between px-4 py-3.5">
              <Link href={`/projects/${p.id}`} className="font-medium hover:text-[var(--brand)]">{p.name}</Link>
              <button onClick={() => remove(p.id)} className="text-sm text-[var(--danger)] hover:underline">Delete</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
