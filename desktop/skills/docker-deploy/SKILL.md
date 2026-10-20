---
name: docker-deploy
description: "Containerize and deploy apps: Dockerfile best practices (multi-stage, slim base, non-root, .dockerignore), docker compose for app + database, env and secrets, health checks, and deploying to Render, Railway, Fly.io or Vercel with a go-live checklist. Use when the user asks to dockerize, containerize, deploy, host, publish or put an app online."
---

# Docker and deploy

Ship the smallest image that runs the app as a non-root user, configured entirely through env vars.

## 1. Pick the host first (it may make Docker unnecessary)
- Static sites / Vite builds / Next.js: **Vercel** (free hobby tier) or Netlify, Cloudflare Pages. No Docker.
- Node/Python web service + DB: **Render** (free web service sleeps after ~15 min idle; free Postgres
  expires after a limited period), **Railway** (trial credits, then usage-based), **Fly.io**
  (pay-as-you-go, small machines cheap). Check current free-tier terms on their pricing pages and tell
  the user.
- Free Postgres separately: Neon or Supabase.
Render and Railway can build from a Dockerfile or detect Node/Python automatically.

## 2. Dockerfile: Node (multi-stage)
```dockerfile
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
```
Next.js: set `output: 'standalone'` and copy `.next/standalone`, `.next/static`, `public`.

## 3. Dockerfile: Python
```dockerfile
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd --create-home app
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## 4. Rules
- Copy dependency manifests first, install, then copy source (layer caching).
- Pin base image major versions (`node:22-slim`, `python:3.12-slim`); avoid `latest`. Alpine only if
  you know native modules work with musl.
- Listen on `0.0.0.0` and on `process.env.PORT` / `$PORT` (hosts inject PORT).
- One process per container. Logs to stdout/stderr.
- `.dockerignore`:
```
node_modules
.git
.env
.venv
__pycache__
dist
.next
*.log
```

## 5. docker compose for local app + DB
```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    env_file: .env
    environment:
      DATABASE_URL: postgres://app:app@db:5432/app
    depends_on:
      db: { condition: service_healthy }
  db:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: app }
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s
      retries: 10
volumes:
  pgdata:
```
Commands: `docker compose up --build -d`, `docker compose logs -f app`, `docker compose down`
(add `-v` only when you intend to delete the database volume).

## 6. Env and secrets
- Never bake secrets into images (no `COPY .env`, no `ENV API_KEY=...`). Set them in the host's
  dashboard or `fly secrets set KEY=value`.
- Keep `.env.example` with every variable name. Validate env at startup.

## 7. Health checks
Expose `GET /health` returning 200 quickly (optionally checks DB). Configure it as the host's health check
path so broken deploys do not receive traffic.

## 8. Deploy steps
- Render: push to GitHub, New Web Service, pick repo, set build/start commands (or Dockerfile), env vars,
  health check path.
- Railway: `npm i -g @railway/cli`, `railway login`, `railway init`, `railway up`; add Postgres from the dashboard.
- Fly.io: install flyctl (`iwr https://fly.io/install.ps1 -useb | iex`), `fly launch`, `fly deploy`.
- Vercel: `npx vercel` (preview) then `npx vercel --prod`.
- Run DB migrations as part of release (`npx prisma migrate deploy`, `alembic upgrade head`), not at
  every container start of every replica.

## Go-live checklist
1. Build and run the image locally: `docker build -t myapp .` then
   `docker run --rm -p 3000:3000 --env-file .env myapp`; hit `/health` with `Invoke-RestMethod`.
2. Image size reasonable (`docker images myapp`; Node slim apps ~200–400MB, not 1.5GB).
3. Production env vars set; debug mode off; CORS limited to the real domain; HTTPS (hosts provide it).
4. Database backups enabled; migrations applied.
5. After deploy: open the live URL with inspect_preview, test the main flow, check host logs for errors.
6. Tell the user the URL, where env vars live, and free-tier limits (sleeping, expiry).

## Common mistakes
- App listening on `localhost`/`127.0.0.1` inside the container (unreachable).
- Missing `.dockerignore`, copying `node_modules` and `.env` into the image.
- Running as root; using `npm install` instead of `npm ci`.
- SQLite file inside an ephemeral container (data lost on redeploy): use a volume or hosted Postgres.
