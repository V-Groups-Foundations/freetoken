# Contributing to FreeToken & V-Run

Thanks for helping make free AI more useful! Every contribution counts — a new provider, a bug fix, a clearer doc, or just an issue describing what you'd like.

## Setup

```bash
git clone https://github.com/varunkar2003/freetoken.git && cd freetoken
npm install
npm run setup   # .env.local + built-in database
npm run dev     # http://localhost:3000
```

V-Run (the desktop app) lives in `desktop/`: `npm run desktop` builds and opens it.

## Before you open a PR

```bash
npm run lint && npx tsc --noEmit && npm test      # web app (Vitest)
cd desktop && npm run typecheck && npm run test:all   # V-Run unit tests
```

V-Run also has end-to-end suites that drive the real app against fake AI servers (`npm run e2e`, `npm run e2e:ft` in `desktop/`).

## Good first contributions

- **Add a free provider** — see `src/providers/registry.ts` and `src/catalog/seed.ts`.
- **Improve the docs** — setup on your OS, a guide for using the API with your favourite tool.
- **V-Run ideas** — open an issue describing what would make the agent better for you.

## Guidelines

- Keep changes focused; one topic per PR.
- Match the surrounding code style; add or update a test when you change behaviour.
- Never commit API keys or `.env.local`.

By contributing you agree your work is released under the [MIT License](LICENSE).
