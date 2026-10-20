---
name: api-integration
description: "Integrate third-party APIs (Stripe, OpenAI, GitHub, weather, maps, any REST/JSON service): read the docs, keep keys in env, a typed client wrapper, timeouts, retries with backoff for 429/5xx, pagination, webhook signature verification, caching and showing errors in the UI. Use when the user asks to connect to, call, fetch from, or integrate an external API, SDK or webhook."
---

# API integration

External APIs fail, rate-limit and change. Wrap them once, defensively, and keep keys on the server.

## 1. Read before writing
- Find the official docs for: base URL, auth method (header name/format), the exact endpoints needed,
  request/response shapes, rate limits, pagination style, error format, and webhook signing.
- Prefer the official SDK when one exists and is maintained (`stripe`, `openai`, `@octokit/rest`);
  it handles auth, retries and types. Otherwise use `fetch` (Node 18+) or `httpx` (Python).
- Make one manual call first to see the real response:
```powershell
$h = @{ Authorization = "Bearer $env:WEATHER_API_KEY" }
Invoke-RestMethod "https://api.example.com/v1/forecast?city=Paris" -Headers $h | ConvertTo-Json -Depth 5
```

## 2. Keys and where calls happen
- Keys in `.env` (gitignored), listed by name in `.env.example`, read once in config.
- Secret keys are used only on the server. A browser app calls *your* backend route, which calls the
  API. Never put secret keys in frontend code or `VITE_`/`NEXT_PUBLIC_` variables.
- Only publishable keys designed for browsers (Stripe publishable key, Maps key with referrer
  restrictions) may go to the client.

## 3. A client wrapper (one module per API)
```ts
// src/lib/weather.ts
const BASE = 'https://api.example.com/v1';
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.WEATHER_API_KEY}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after')) * 1000;
    const wait = retryAfter || 2 ** attempt * 500 + Math.random() * 250;   // 0.5s, 1s, 2s + jitter
    await new Promise(r => setTimeout(r, wait));
    return request<T>(path, init, attempt + 1);
  }
  if (!res.ok) throw new ApiError(res.status, `Weather API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}
export type Forecast = { city: string; days: { date: string; highC: number; lowC: number }[] };
export const getForecast = (city: string) => request<Forecast>(`/forecast?city=${encodeURIComponent(city)}`);
```
- Timeouts on every call (5–15s). Retry only idempotent requests (GET, or POST with an idempotency key).
- Never retry 4xx other than 429; they will fail the same way.
- Validate responses you depend on with zod/pydantic when the API is loosely documented.
- Python: `httpx.Client(base_url=..., timeout=10)`; retries with `tenacity` or a small loop.

## 4. Pagination
Follow the API's style: cursor (`next_cursor`, `Link` header), page/offset, or `has_more` + `starting_after`.
Loop until done, with a hard cap on pages, and respect rate limits between pages.
```ts
async function* allItems() { let cursor; do { const p = await request(`/items?limit=100${cursor ? `&cursor=${cursor}` : ''}`); yield* p.data; cursor = p.next_cursor; } while (cursor); }
```

## 5. Webhooks
- Endpoint (`POST /webhooks/stripe`) reads the **raw body** (Express: `express.raw({ type: 'application/json' })`
  on that route only) and verifies the signature with the provider's method
  (`stripe.webhooks.constructEvent(raw, sig, secret)`) or an HMAC with `crypto.timingSafeEqual`.
- Reject unverified or old events (timestamp tolerance ~5 min). Return 2xx fast; do heavy work in a job.
- Handle duplicates: store processed event ids and skip repeats (idempotency).
- Local testing: the provider's CLI (`stripe listen --forward-to localhost:3000/webhooks/stripe`) or a tunnel.

## 6. Caching and limits
- Cache responses that change slowly (in-memory Map with TTL, or Redis): e.g. weather 10 min, exchange
  rates 1 h. Key by all inputs.
- Deduplicate concurrent identical requests; debounce user-triggered calls (search 300ms).
- Track usage against quotas; log status codes and latency (never the key).

## 7. Errors in the UI
- Map failures to messages users can act on: "Weather is unavailable right now. Try again in a minute."
  with a Retry button; keep showing cached/stale data when available.
- Loading state while waiting; disable duplicate submits.
- Log the full technical error server-side; do not show raw API errors or stack traces to users.

## Check before you finish
1. Happy path works end to end with the real key (run_app, then call your route or use the UI via inspect_preview).
2. Simulate failure: wrong key (expect a clear 401 message), unreachable host or timeout (UI shows the error state).
3. Search the frontend bundle/source for the secret key name and value: must not appear.
4. Webhook: a request with a bad signature gets 400; a valid replayed event is processed once.

## Common mistakes
- Keys committed or shipped to the browser; calling secret APIs directly from React.
- No timeout, so one slow API hangs the server; retry loops without backoff or cap.
- Assuming the response shape without checking real output; ignoring pagination (only first 100 items).
- Parsing webhook JSON before verifying the signature on the raw body.
