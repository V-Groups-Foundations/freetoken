export interface TapResult {
  usage: { promptTokens: number; completionTokens: number } | null;
  completionChars: number;
  failed: boolean;
}

/** Passes an OpenAI-style SSE stream through unchanged while reading usage/content. */
export function tapSseUsage(body: ReadableStream<Uint8Array>, onDone: (r: TapResult) => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let usage: TapResult['usage'] = null;
  let completionChars = 0;
  let finished = false;

  const finish = (failed: boolean) => {
    if (finished) return;
    finished = true;
    onDone({ usage, completionChars, failed });
  };

  const scan = (line: string) => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const j = JSON.parse(data);
      const u = j.usage ?? j.x_groq?.usage;
      if (u?.prompt_tokens != null) usage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens ?? 0 };
      const content = j.choices?.[0]?.delta?.content;
      if (typeof content === 'string') completionChars += content.length;
    } catch {
      // Ignore malformed lines; the client still receives the raw bytes.
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer) scan(buffer);
          finish(false);
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        lines.forEach(scan);
        controller.enqueue(value);
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
