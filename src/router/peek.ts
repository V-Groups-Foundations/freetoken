/**
 * Reads an SSE stream up to its first data event. Some providers open a stream (HTTP 200) and then
 * send only an error ("Upstream error from Nvidia: Service temporarily overloaded"): once the stream
 * is passed to the client it's too late to try another model, so the router looks first. The stream
 * comes back whole, the part already read included.
 */
export async function peekFirstEvent(body: ReadableStream<Uint8Array>): Promise<{ error: string | null; stream: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let text = '';
  let error: string | null = null;
  let found = false;
  let done = false;
  let eventName = '';
  let scanned = 0; // characters of `text` already looked at, up to the last complete line

  while (!found) {
    const r = await reader.read().catch(() => ({ done: true as const, value: undefined }));
    if (r.done) { done = true; break; }
    chunks.push(r.value);
    text += decoder.decode(r.value, { stream: true });
    let nl: number;
    while (!found && (nl = text.indexOf('\n', scanned)) !== -1) {
      const line = text.slice(scanned, nl).replace(/\r$/, '');
      scanned = nl + 1;
      if (line.startsWith('event:')) { eventName = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;
      found = true;
      if (data === '[DONE]') { error = 'the answer was empty'; break; }
      try {
        const j = JSON.parse(data);
        if (j?.error) error = String(j.error.message ?? j.error).slice(0, 300);
        else if (eventName === 'error') error = String(j?.message ?? data).slice(0, 300);
      } catch {
        if (eventName === 'error') error = data.slice(0, 300);
      }
    }
    // a provider that sends something other than SSE: leave it to the client, as before
    if (!found && text.length > 64_000) found = true;
  }
  if (!found && done) error = 'the answer was empty';

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      if (done) controller.close();
    },
    async pull(controller) {
      try {
        const r = await reader.read();
        if (r.done) controller.close();
        else controller.enqueue(r.value);
      } catch (e) {
        controller.error(e);
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
  return { error, stream };
}
