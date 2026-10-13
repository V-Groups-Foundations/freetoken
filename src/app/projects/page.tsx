import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listProjects } from '@/projects/service';
import { ProjectList } from './project-list';

export default async function ProjectsPage() {
  const uid = await requireUserId();
  const projects = await listProjects(getDb(), uid);
  return (
    <section className="space-y-6">
      <div>
        <h1 className="h2">Projects</h1>
        <p className="muted mt-1 max-w-2xl">
          A project keeps one conversation that the chat, the web terminal, and your desktop terminal all
          share — pick up anywhere you left off.
        </p>
      </div>
      <ProjectList initial={projects.map((p) => ({ id: p.id, name: p.name }))} />
    </section>
  );
}
