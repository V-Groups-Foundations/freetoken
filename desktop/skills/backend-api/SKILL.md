---
name: backend-api
description: "Design and build a REST/JSON API with Node (Express or Fastify) or Python (FastAPI): layout, routes, validation with zod or pydantic, error format, status codes, pagination, CORS, config, logging and testing with Invoke-RestMethod/curl. Use when the user asks for a backend, server, API, endpoints or CRUD service."
---

# Backend API

A good API is predictable: same URL patterns, same error shape, validated input, correct status codes.

## 1. Choose the stack
- Node, simple: Express 5 (`npm i express zod cors dotenv`). Node, faster with schemas: Fastify
  (`npm i fastify @fastify/cors zod`). Python: FastAPI (`pip install "fastapi[standard]"`, which includes uvicorn).
- Match the language of the existing project. Use TypeScript for new Node APIs if the project uses it.

## 2. Project layout
```
src/
  index.(ts|js)      # create app, middleware, listen
  config.(ts|js)     # read and validate env once
  routes/users.(ts|js)
  services/users.(ts|js)   # business logic, no req/res here
  db.(ts|js)
tests/
.env.example         # every variable, no real secrets
```
Python: `app/main.py`, `app/routers/users.py`, `app/schemas.py`, `app/services/`, `app/config.py`.

## 3. Routes and status codes
- Plural nouns, no verbs: `GET /api/users`, `GET /api/users/:id`, `POST /api/users`,
  `PATCH /api/users/:id`, `DELETE /api/users/:id`. Nest only one level: `/api/users/:id/posts`.
- 200 OK (read/update), 201 Created (POST, include the object), 204 No Content (DELETE),
  400 malformed, 401 not logged in, 403 not allowed, 404 not found, 409 conflict (duplicate),
  422 validation failed, 429 rate limited, 500 unexpected. Never return 200 with an error inside.
- Add `GET /health` returning `{ "status": "ok" }`.

## 4. Validate every input
Validate body, params and query at the edge; services receive clean typed data.
```js
import { z } from 'zod';
const CreateUser = z.object({ email: z.string().email(), name: z.string().min(1).max(100) });
app.post('/api/users', async (req, res, next) => {
  const parsed = CreateUser.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ error: { code: 'validation_error',
    message: 'Invalid input', details: parsed.error.flatten().fieldErrors } });
  try { res.status(201).json(await users.create(parsed.data)); } catch (e) { next(e); }
});
```
FastAPI: declare a pydantic `BaseModel` as the parameter type; it returns 422 automatically.

## 5. One error shape
Always: `{ "error": { "code": "not_found", "message": "User 42 not found", "details": {} } }`.
- Express: one error middleware at the end `app.use((err, req, res, next) => ...)` that logs the stack
  and returns 500 with a generic message (never leak stack traces to clients).
- FastAPI: raise `HTTPException(404, detail=...)` or add an `@app.exception_handler` for your own errors.

## 6. Pagination, filtering, sorting
- `GET /api/items?limit=20&cursor=abc` (cursor) or `?page=2&limit=20` (offset, fine for small data).
- Cap `limit` (default 20, max 100). Response: `{ "data": [...], "nextCursor": "..." | null }`
  or `{ "data": [...], "page": 2, "total": 340 }`.
- Sort with `?sort=-createdAt`; whitelist sortable fields.

## 7. CORS, config, logging
- CORS: allow only known origins from env (`CORS_ORIGINS=http://localhost:5173`), not `*` with credentials.
- Config: load `.env` with `dotenv` (Node) or `pydantic-settings` (Python); fail at startup if a required
  variable is missing. `PORT` defaults to 3000 (Node) / 8000 (Python).
- Logging: one line per request (method, path, status, ms). Fastify has pino built in; Express: `pino-http`.
  Log errors with stack server-side. Never log passwords, tokens or full card numbers.
- Parse JSON with a size limit (`express.json({ limit: '1mb' })`).

## 8. Run and test by hand (PowerShell)
- Start with run_app: `npm run dev` (add `"dev": "node --watch src/index.js"`) or
  `uvicorn app.main:app --reload --port 8000`.
- Requests:
```powershell
Invoke-RestMethod http://localhost:3000/health
Invoke-RestMethod -Method Post http://localhost:3000/api/users -ContentType 'application/json' -Body '{"email":"a@b.co","name":"Ada"}'
curl.exe -i http://localhost:3000/api/users/999   # curl.exe, not the PowerShell curl alias; -i shows status
```
- FastAPI gives interactive docs at `/docs`; check them with inspect_preview.

## Check before you finish
1. Server starts without errors; `/health` returns 200.
2. Each endpoint: one happy request, one invalid body (expect 422), one missing id (expect 404).
3. Automated tests exist for the main routes (supertest + Vitest, or FastAPI `TestClient` + pytest) and pass.
4. `.env.example` lists every variable; `.env` is in `.gitignore`.

## Common mistakes
- Trusting `req.body` without validation; building SQL by string concatenation (use parameters/ORM).
- Unhandled promise rejections crashing the server (wrap async handlers or use Express 5 / Fastify).
- Returning different shapes from different endpoints.
- Business logic inside route handlers, making it untestable.
- Hard-coded ports, URLs and secrets.
