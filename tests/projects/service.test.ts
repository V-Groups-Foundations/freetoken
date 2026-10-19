import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createUser } from '../helpers/db';
import { sse } from '../helpers/fake-fetch';
import type { DB } from '@/db';
import {
  createProject, listProjects, getProject, deleteProject, setProjectModel,
  listMessages, addMessage, appendMessages,
} from '@/projects/service';
import { persistAssistant } from '@/projects/stream';

let db: DB;
let userId: string;
beforeEach(async () => {
  db = await createTestDb();
  userId = (await createUser(db)).id;
});

describe('projects service', () => {
  it('creates, lists and scopes projects to the user', async () => {
    const p = await createProject(db, userId, 'My app');
    expect(p).toMatchObject({ name: 'My app', model: 'auto-smart' });
    const other = (await createUser(db)).id;
    await createProject(db, other, 'Theirs');
    expect((await listProjects(db, userId)).map((x) => x.name)).toEqual(['My app']);
  });

  it('getProject returns null for another user', async () => {
    const other = (await createUser(db)).id;
    const p = await createProject(db, other, 'Theirs');
    expect(await getProject(db, userId, p.id)).toBeNull();
    expect(await getProject(db, other, p.id)).toMatchObject({ name: 'Theirs' });
  });

  it('stores and reads the shared conversation in order', async () => {
    const p = await createProject(db, userId, 'Chat');
    await addMessage(db, p.id, { role: 'user', content: 'hi' });
    await addMessage(db, p.id, { role: 'assistant', content: 'hello', provider: 'groq/x' });
    const msgs = await listMessages(db, p.id);
    expect(msgs.map((m) => [m.role, m.content, m.provider ?? null])).toEqual([
      ['user', 'hi', null],
      ['assistant', 'hello', 'groq/x'],
    ]);
  });

  it('updates the model and deletes with its messages', async () => {
    const p = await createProject(db, userId, 'X');
    await setProjectModel(db, userId, p.id, 'auto-fast');
    expect((await getProject(db, userId, p.id))!.model).toBe('auto-fast');
    await addMessage(db, p.id, { role: 'user', content: 'a' });
    await deleteProject(db, userId, p.id);
    expect(await getProject(db, userId, p.id)).toBeNull();
    expect(await listMessages(db, p.id)).toEqual([]);
  });
});

describe('persistAssistant', () => {
  it('passes the stream through and saves the assembled assistant reply', async () => {
    const p = await createProject(db, userId, 'Chat');
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const out = new Response(persistAssistant(sse(chunks).body!, db, p.id, 'groq/x'));
    expect(await out.text()).toBe(chunks.join(''));
    await new Promise((r) => setTimeout(r, 30));
    const msgs = await listMessages(db, p.id);
    expect(msgs.at(-1)).toMatchObject({ role: 'assistant', content: 'Hello', provider: 'groq/x' });
  });

  it('does not save an empty reply when the stream fails immediately', async () => {
    const p = await createProject(db, userId, 'Chat');
    const broken = new ReadableStream({ pull(c) { c.error(new Error('reset')); } });
    await new Response(persistAssistant(broken, db, p.id, 'groq/x')).text().catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    expect(await listMessages(db, p.id)).toEqual([]);
  });

  it('appendMessages writes V-Run turns into the shared conversation, only for the owner', async () => {
    const p = await createProject(db, userId, 'Desk');
    await addMessage(db, p.id, { role: 'user', content: 'start on the web' });
    const added = await appendMessages(db, userId, p.id, [
      { role: 'user', content: 'continue on desktop' },
      { role: 'assistant', content: 'done in V-Run', provider: 'v-run' },
    ]);
    expect(added).toHaveLength(2);
    expect((await listMessages(db, p.id)).map((m) => m.content)).toEqual(['start on the web', 'continue on desktop', 'done in V-Run']);
    const other = (await createUser(db)).id;
    expect(await appendMessages(db, other, p.id, [{ role: 'user', content: 'x' }])).toBeNull();
  });
});
