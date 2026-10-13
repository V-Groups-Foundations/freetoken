export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

export function fakeFetch(handler: Handler) {
  const calls: { url: string; auth: string | null; body: Record<string, unknown> | null }[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      auth: new Headers(init.headers).get('authorization'),
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

export const okJson = (content = 'hello', usage: object | null = { prompt_tokens: 5, completion_tokens: 2 }) =>
  Response.json({
    id: 'x',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    ...(usage ? { usage } : {}),
  });

export const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
