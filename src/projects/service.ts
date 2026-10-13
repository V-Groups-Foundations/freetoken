import { and, asc, desc, eq } from 'drizzle-orm';
import type { DB } from '@/db';
import { projectMessages, projects } from '@/db/schema';

export async function createProject(db: DB, userId: string, name: string, model = 'auto-smart') {
  const [p] = await db.insert(projects).values({ userId, name, model }).returning();
  return p;
}

export async function listProjects(db: DB, userId: string) {
  return db
    .select({ id: projects.id, name: projects.name, model: projects.model, updatedAt: projects.updatedAt })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));
}

export async function getProject(db: DB, userId: string, id: string) {
  const [p] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
  return p ?? null;
}

export async function setProjectModel(db: DB, userId: string, id: string, model: string) {
  await db.update(projects).set({ model, updatedAt: new Date() }).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function touchProject(db: DB, id: string) {
  await db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, id));
}

export async function deleteProject(db: DB, userId: string, id: string) {
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function listMessages(db: DB, projectId: string) {
  return db
    .select({ id: projectMessages.id, role: projectMessages.role, content: projectMessages.content, provider: projectMessages.provider })
    .from(projectMessages)
    .where(eq(projectMessages.projectId, projectId))
    .orderBy(asc(projectMessages.id));
}

export async function addMessage(
  db: DB,
  projectId: string,
  m: { role: 'user' | 'assistant'; content: string; provider?: string | null },
) {
  const [row] = await db.insert(projectMessages).values({ projectId, role: m.role, content: m.content, provider: m.provider ?? null }).returning();
  return row;
}
