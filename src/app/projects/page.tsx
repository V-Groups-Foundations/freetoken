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
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-neutral-600">
          A project keeps one conversation that both the chat and the terminal share — pick up in
          the terminal where you left off in chat, and the other way round.
        </p>
      </div>
      <ProjectList initial={projects.map((p) => ({ id: p.id, name: p.name }))} />
    </section>
  );
}
