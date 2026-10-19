<div align="center">

<img src="public/brand/vgroups.jpg" width="560" alt="V Groups" />

<h1>FreeToken · free AI tokens for everyone</h1>

<p><strong>Pool every free AI tier — Gemini, Groq, OpenRouter, NVIDIA, Cohere, GitHub Models and more — into<br/>one chat, one OpenAI-compatible API, and V-Run, a desktop AI coding agent. $0, no credit card, self-hosted.</strong></p>

<a href="https://readme-typing-svg.demolab.com">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1000&color=3AD1FF&center=true&vCenter=true&width=640&lines=Free+AI+API+%E2%80%94+one+key+for+every+free+model.;A+Cursor+%2F+Claude+Code+style+agent%2C+for+free.;One-line+setup.+No+key+needed+to+start." alt="FreeToken" />
</a>

[![GitHub stars](https://img.shields.io/github/stars/V-Groups-Foundations/freetoken?style=social)](https://github.com/V-Groups-Foundations/freetoken/stargazers)
[![CI](https://github.com/V-Groups-Foundations/freetoken/actions/workflows/ci.yml/badge.svg)](https://github.com/V-Groups-Foundations/freetoken/actions/workflows/ci.yml)
![Cost](https://img.shields.io/badge/cost-%240%20forever-22c55e)
![Setup](https://img.shields.io/badge/setup-one%20line-3ad1ff)
![OpenAI compatible](https://img.shields.io/badge/API-OpenAI%20compatible-a78bfa)
![Tests](https://img.shields.io/badge/tests-235%20passing-22c55e)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

**[Quick start](#-quick-start-one-line) · [Features](#-what-you-get) · [V-Run desktop app](#%EF%B8%8F-v-run--the-free-ai-coding-agent) · [FAQ](#-faq)**

<sub>A <b>V Groups</b> project · if it saves you money, a ⭐ helps others find it</sub>

</div>

---

## 💡 What is FreeToken?

Every AI company gives away a free tier — Google Gemini, Groq, OpenRouter, NVIDIA NIM, Cohere, GitHub Models… On its own each one runs out fast. **FreeToken pools them.** Add the free API keys you sign up for (no card needed for most), and every request goes to whichever provider still has quota, falling back automatically the moment one is rate-limited.

You get **free AI tokens** through:

- 💬 **A chat app** — like ChatGPT, but running on every free model you have.
- 🔌 **Your own OpenAI-compatible API** — point Cursor, Continue, Cline, LangChain or your scripts at it: `base_url=http://localhost:3000/api/v1`.
- 🖥️ **V-Run** — a desktop AI code editor (think Cursor / Claude Code) whose agent writes code, runs your app and fixes what it sees — on free models.

Your keys are encrypted and used only for *your* requests. Nothing is shared, nothing is billed.

```
  Gemini ┐
  Groq   ┤                      ┌─► 💬 Chat
  NVIDIA ┼──►  FreeToken router ┼─► 🔌 OpenAI-compatible API
  Cohere ┤     (auto-failover)  └─► 🖥️ V-Run coding agent
  GitHub ┘
```

## ⚡ Quick start (one line)

**Windows** (PowerShell):

```powershell
irm https://raw.githubusercontent.com/V-Groups-Foundations/freetoken/master/install.ps1 | iex
```

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/V-Groups-Foundations/freetoken/master/install.sh | bash
```

That's it. Your browser opens **already signed in** (no account, no password — a private link only your computer has), and **chat works immediately** with the built-in starter model — no API key needed.

Then make it fast: on **Connect**, click *Get key* for Gemini or Groq, copy the key on their page, and come back — it's added automatically. OpenRouter is one click. Already have keys? Paste them all at once (or a whole `.env` file) and FreeToken recognises each one.

<details><summary>Prefer to do it by hand?</summary>

You need **Node.js 20.9+**. The database is built in.

```bash
git clone https://github.com/V-Groups-Foundations/freetoken.git
cd freetoken
npm install
npm run dev       # sets itself up, then opens http://localhost:3000 signed in
```
</details>

**Want the desktop coding agent too?**

```bash
npm run desktop   # builds and opens V-Run — it starts FreeToken and connects itself
```

## 🤖 Claude Code, Cursor & Cline — on free models

FreeToken speaks both the **OpenAI** API (`/api/v1/chat/completions`) and the **Anthropic** API (`/api/v1/messages`, with streaming and tool use), so the AI tools you already use run on your free pool:

```bash
freetoken run claude              # Claude Code, on free models (in this folder: npm run claude)
freetoken run aider --model openai/auto-smart
freetoken setup cursor            # copy-paste setup for Cursor, Cline, Continue, Codex, OpenCode…
```

`freetoken run` only sets the environment for that one run — your tool's own settings are untouched. Claude model names map to FreeToken automatically (`haiku` → `auto-fast`, everything else → `auto-smart`). The **API** page in the app shows the same setup with your URLs.

## 📸 Screenshots

| V-Run: the agent edits, runs and verifies | V-Run: your FreeToken hub |
|---|---|
| ![V-Run agent](docs/screenshots/vrun-agent.png) | ![FreeToken hub in V-Run](docs/screenshots/vrun-freetoken-hub.png) |
| **FreeToken on the web** | **The V Groups family** |
| ![FreeToken home](docs/screenshots/freetoken-home.png) | ![V Groups](docs/screenshots/v-groups.png) |

## 🚀 What you get

| | |
|---|---|
| 🔀 **Smart routing** | `auto-smart` / `auto-fast` pick a provider with quota left; instant fallback on rate limits. |
| 🔌 **OpenAI-compatible API** | `/api/v1/chat/completions`, streaming and tool calls — works with any OpenAI SDK or tool. |
| 💬 **Chat** | Markdown, images, voice in/out, attachments, across all your providers. |
| 📁 **Projects** | One conversation per project — plan it in chat, then **Continue in V-Run** with the whole context. |
| 🎨 **Image studio** | Keyless image generation (Flux / Turbo) plus an optional Gemini engine. |
| 📄 **Chat with docs** | Text, PDFs and images (OCR) with cited answers (RAG). |
| 🌐 **Web** | Keyless URL reader and Tavily search, in chat and in the agents. |
| 🛠️ **Tools** | Extract · translate · summarize · classify. |
| 📊 **Usage dashboard** | Exactly how much free quota you have left, per provider and per model. |
| 🖥️ **Terminal agent** | `freetoken` CLI: a coding agent in your terminal; you approve each step. |
| 🤖 **Anthropic-compatible API** | `/api/v1/messages` — run Claude Code and Anthropic SDKs on free models (`freetoken run claude`). |

## 🖥️ V-Run — the free AI coding agent

<img src="public/brand/vrun.jpg" width="440" alt="V-Run" />

`desktop/` is **V-Run**, a desktop AI code editor (Electron + Monaco) — a free alternative to Cursor and Claude Code that runs on your FreeToken models (or Claude, with your own key).

- **Agent, Plan and Ask modes** — the agent reads, searches, edits files and runs commands; Plan mode proposes a plan you approve first.
- **Accept all or step by step** — chosen once per task, so it never nags you mid-job.
- **Runs your app** — starts your web app inside the editor, *sees* the page and its console errors, and fixes them. One-click **Fix with AI** on crashes.
- **Diffs, rewind and retry** — every edit shown as a diff; rewind any message to undo its file changes.
- **Memory with `V.md`** — like `CLAUDE.md`: `/init` writes your project's memory, `# note` adds to it, and the agent remembers lasting facts on its own.
- **Visible reasoning, follow-up suggestions, @file mentions, Tab completion and Ctrl+K inline edits.**
- **FreeToken built in** — sign in with one click, browse projects, usage and models in the FreeToken hub, and **Continue in V-Run** from any FreeToken project (its turns are saved back to the web chat).

## 🔑 Free providers you can connect

| Provider | Free tier |
|---|---|
| **Kilo Gateway · LLM7** | **work with no key at all** — used out of the box (Nemotron Ultra 550B, DeepSeek V4 Flash, Codestral…) |
| Google Gemini · Groq · NVIDIA NIM · Cohere · GitHub Models · SambaNova | free, no card |
| Cloudflare Workers AI | 10,000 neurons/day free (GPT-OSS 120B, GLM 4.7 Flash) |
| Z.ai | GLM Flash models free |
| OpenRouter · Requesty | free models (OpenRouter 50/day, Requesty 200/day) |

Optional tools: Tavily (web search) · DeepL (translation) · Jina (embeddings) · OCR.space (scanned files) · ElevenLabs / Google TTS (voices).

## ❓ FAQ

<details><summary><b>Is it really free?</b></summary>

Yes. FreeToken is open source (MIT) and runs on your machine. It uses the free tiers that AI providers already offer; you sign up for them yourself (most need no credit card). FreeToken just makes them work together — no subscription, no hidden costs. Out of the box it also includes a keyless starter model (via [Pollinations](https://pollinations.ai)'s free tier) so you can try everything before adding a single key; it's shared and rate-limited, so add your own free keys for real use, and set `FREETOKEN_STARTER=off` to turn it off.
</details>

<details><summary><b>Where do the "free tokens" come from?</b></summary>

From your own free accounts with each provider. FreeToken doesn't resell or share anyone's quota — it routes *your* requests across *your* free tiers so you rarely hit a limit.
</details>

<details><summary><b>Can I use it with Cursor, Continue, Cline or LangChain?</b></summary>

Yes — create a token under **API** and use `http://localhost:3000/api/v1` as an OpenAI base URL with model `auto-smart`.
</details>

<details><summary><b>Are my API keys safe?</b></summary>

They're encrypted at rest with your own `VAULT_MASTER_KEY` (generated on first start) and only ever sent to the provider they belong to. Signing in on your own computer uses a random link that changes every start and is readable only on your machine (like Jupyter's token); set `FREETOKEN_LOCAL_LOGIN=off` if you host FreeToken for others.
</details>

<details><summary><b>How is V-Run different from Cursor or Claude Code?</b></summary>

Same idea — an editor with an agent that edits code and runs commands — but it's free, open source, runs on free models through FreeToken, and can run and look at your app while it works.
</details>

## 🧱 Tech stack

Next.js 16 · React 19 · TypeScript · Drizzle ORM · PGlite (embedded Postgres) · Auth.js v5 · Tailwind v4 · Vitest — and for V-Run: Electron · Monaco · Vite.

## 🤝 Contributing

Contributions are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first steps: add a free provider, improve the docs, or try V-Run and open an issue with what you'd like next.

## ⭐ Support the project

FreeToken is free and will stay free. If it helps you, **star the repo** and share it — that's how other people find free AI tools.

[![Star History Chart](https://api.star-history.com/svg?repos=V-Groups-Foundations/freetoken&type=Date)](https://star-history.com/#V-Groups-Foundations/freetoken&Date)

## 📄 License

MIT — see [LICENSE](LICENSE). Use it, fork it, share it.

<div align="center"><sub>Made by <b>V Groups</b> · build it for free, use it for free.</sub></div>
