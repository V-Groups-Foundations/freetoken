import type { DB } from '@/db';
import { tapAssistant } from '@/server/stream';
import { addMessage, touchProject } from './service';

/**
 * Persist a project's assistant reply once the stream finishes cleanly, so the chat
 * and the terminal share one memory: every answer lands in the same table.
 */
export function persistAssistant(
  body: ReadableStream<Uint8Array>,
  db: DB,
  projectId: string,
  provider: string | null,
): ReadableStream<Uint8Array> {
  return tapAssistant(body, (text) => {
    void addMessage(db, projectId, { role: 'assistant', content: text, provider })
      .then(() => touchProject(db, projectId))
      .catch((e) => console.error('persist project assistant failed', e));
  });
}
