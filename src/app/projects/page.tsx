import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listProjects } from '@/projects/service';
import { PageHeader } from '../page-header';
import { ProjectList } from './project-list';

export default async function ProjectsPage() {
  const uid = await requireUserId();
  const projects = await listProjects(getDb(), uid);
  return (
    <section className="space-y-6">
      <PageHeader
        title="Projects"
        subtitle="A project keeps one conversation that the chat, the web terminal, and your desktop terminal all share — pick up anywhere you left off."
      />
      <ProjectList initial={projects.map((p) => ({ id: p.id, name: p.name }))} />
    </section>
  );
}
