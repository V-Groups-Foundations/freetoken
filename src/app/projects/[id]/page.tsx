import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { getProject, listMessages } from '@/projects/service';
import { listUserModels } from '@/router/models';
import { Workspace } from './workspace';

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const uid = await requireUserId();
  const { id } = await params;
  const db = getDb();
  const project = await getProject(db, uid, id);
  if (!project) redirect('/v-run');
  const [messages, models] = await Promise.all([listMessages(db, id), listUserModels(db, uid)]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/v-run" className="muted text-sm hover:text-[var(--ink)]">← V-Run projects</Link>
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
      </div>
      <Workspace
        projectId={id}
        projectName={project.name}
        initialModel={project.model}
        models={models}
        initialMessages={messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content, provider: m.provider ?? undefined }))}
      />
    </section>
  );
}
