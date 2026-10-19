import { getDb } from '@/db';
import { requireUserId } from '@/lib/session';
import { listProjects } from '@/projects/service';
import { PageHeader } from '../page-header';
import { ProjectList } from '../projects/project-list';
import { ConnectVRun } from './connect';
import { OpenVRun } from './launch';

/** V-Run home on the web: your projects (each continues in V-Run with its conversation) and the app link. */
export default async function VRunPage() {
  const uid = await requireUserId();
  const projects = await listProjects(getDb(), uid);
  return (
    <section className="space-y-6">
      <PageHeader
        eyebrow="V Groups · desktop app"
        title="V-Run"
        subtitle="Start a project here, talk it through in Chat, then switch it to V-Run — the desktop app opens the project folder and its agent builds it with the whole conversation."
        actions={<OpenVRun />}
      />
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">Projects</h2>
        <ProjectList initial={projects.map((p) => ({ id: p.id, name: p.name }))} />
      </div>
      <ConnectVRun />
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ['Chat, then build', 'Each project has Chat and V-Run. Plan in Chat; ▶ V-Run hands the project to the desktop app with everything said so far.'],
          ['Run what you build', 'The agent starts your app or website inside V-Run, sees the page and its errors, and fixes them.'],
          ['One account', 'V-Run uses your FreeToken models and limits — no separate keys. Usage shows on the Usage page.'],
        ].map(([title, body]) => (
          <div key={title} className="card card-pad space-y-1">
            <div className="font-medium">{title}</div>
            <p className="muted text-sm">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
