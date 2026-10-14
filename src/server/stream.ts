/**
 * Pass an SSE completion stream through unchanged while assembling the assistant's
 * reply, then hand the finished text to `onComplete` when (and only when) the stream
 * finishes cleanly. This is what lets a chat or a project remember what was said:
 * every answer is captured and saved to the same table its history came from.
 */
export function tapAssistant(
  body: ReadableStream<Uint8Array>,
  onComplete: (text: string) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let settled = false;

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

  const settle = (failed: boolean) => {
    if (settled) return;
    settled = true;
    if (failed || !text) return; // don't persist a partial or empty reply
    onComplete(text);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer) scan(buffer);
          settle(false);
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(scan);
        controller.enqueue(value);
      } catch (e) {
        settle(true);
        controller.error(e);
      }
    },
    cancel(reason) {
      settle(true);
      return reader.cancel(reason);
    },
  });
}
