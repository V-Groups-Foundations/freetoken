export interface TapResult {
  usage: { promptTokens: number; completionTokens: number } | null;
  completionChars: number;
  failed: boolean;
}

/** OpenAI's stream_options.include_usage adds a last chunk with no choices, only usage. */
const isUsageOnly = (j: { choices?: unknown; usage?: unknown }) => Array.isArray(j.choices) && j.choices.length === 0 && j.usage != null;

/**
 * Passes an OpenAI-style SSE stream through while reading usage/content. With `stripUsageChunk`, the
 * usage-only chunk FreeToken asked for on the client's behalf is dropped, so clients that didn't ask
 * for it never see it.
 */
export function tapSseUsage(
  body: ReadableStream<Uint8Array>,
  onDone: (r: TapResult) => void,
  { stripUsageChunk = false }: { stripUsageChunk?: boolean } = {},
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let event: string[] = []; // lines of the SSE event being read (only used when stripping)
  let usage: TapResult['usage'] = null;
  let completionChars = 0;
  let finished = false;

  const finish = (failed: boolean) => {
    if (finished) return;
    finished = true;
    onDone({ usage, completionChars, failed });
  };

  /** Reads one line; returns true when it's the usage-only chunk. */
  const scan = (line: string) => {
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return false;
    try {
      const j = JSON.parse(data);
      const u = j.usage ?? j.x_groq?.usage;
      if (u?.prompt_tokens != null) usage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens ?? 0 };
      const delta = j.choices?.[0]?.delta;
      if (typeof delta?.content === 'string') completionChars += delta.content.length;
      // tool calls and reasoning are output too
      for (const tc of delta?.tool_calls ?? []) completionChars += (tc?.function?.arguments ?? '').length + (tc?.function?.name ?? '').length;
      const reasoning = delta?.reasoning_content ?? delta?.reasoning;
      if (typeof reasoning === 'string') completionChars += reasoning.length;
      return isUsageOnly(j);
    } catch {
      return false; // malformed lines are still passed to the client
    }
  };

  /** Stripping mode: emit a whole event unless it's the usage-only one; true when something was sent. */
  const flushEvent = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (!event.length) return false;
    const drop = event.map(scan).some(Boolean);
    if (!drop) controller.enqueue(encoder.encode(`${event.join('\n')}\n\n`));
    event = [];
    return !drop;
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // Keep reading until something is passed on: a read may hold only the dropped usage chunk or
        // half an event, and returning from pull without enqueuing would stall the stream.
        for (let sent = false; !sent; ) {
          const { done, value } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            if (stripUsageChunk) {
              if (buffer) event.push(buffer.replace(/\r$/, ''));
              flushEvent(controller);
            } else if (buffer) scan(buffer);
            finish(false);
            controller.close();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          if (!stripUsageChunk) {
            lines.forEach(scan);
            controller.enqueue(value);
            return;
          }
          for (const raw of lines) {
            const line = raw.replace(/\r$/, '');
            if (line !== '') event.push(line);
            else if (flushEvent(controller)) sent = true;
          }
        }
      } catch (e) {
        finish(true);
        controller.error(e);
      }
    },
    cancel(reason) {
      finish(true);
      return reader.cancel(reason);
    },
  });
}
