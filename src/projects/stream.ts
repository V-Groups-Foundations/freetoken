import type { DB } from '@/db';
import { addMessage, touchProject } from './service';

/**
 * Pass an SSE completion stream through unchanged while assembling the assistant's
 * reply, and save it to the project when the stream finishes cleanly. This is what
 * makes the chat and the terminal share one memory: every answer lands in the same table.
 */
export function persistAssistant(
  body: ReadableStream<Uint8Array>,
  db: DB,
  projectId: string,
  provider: string | null,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let saved = false;

  const scan = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const content = JSON.parse(data).choices?.[0]?.delta?.content;
      if (typeof content === 'string') text += content;
    } catch {
      /* ignore keep-alive / malformed */
    }
  };

  const save = (failed: boolean) => {
    if (saved) return;
    saved = true;
    if (failed || !text) return; // don't persist a partial or empty reply
    void addMessage(db, projectId, { role: 'assistant', content: text, provider })
      .then(() => touchProject(db, projectId))
      .catch((e) => console.error('persist assistant failed', e));
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer) scan(buffer);
          save(false);
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(scan);
        controller.enqueue(value);
      } catch (e) {
        save(true);
        controller.error(e);
      }
    },
    cancel(reason) {
      save(true);
      return reader.cancel(reason);
    },
  });
}
