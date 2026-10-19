# V-Run

<img src="assets/icon.png" width="72" alt="V-Run logo">

A V Groups product: the desktop coding app of FreeToken (this repo's parent folder). An AI code editor whose agent
runs on your FreeToken models (or Claude through the official Anthropic SDK). It started as *Cursor Remake* in the
`rea` workspace; this folder is now its home. See the main README's "V-Run, the desktop app" section for how the two fit together.

## Run

Brand art: `src/renderer/brand/` (banner + mark used in the UI) and `assets/icon.png` / `assets/icon.ico` (window and taskbar icon).

```bash
npm install
npm run build
npm start                     # opens the editor
```

**AI provider (Settings → Ctrl+,):**
- **Claude:** paste an Anthropic API key (or set `ANTHROPIC_API_KEY`). The default model is `claude-opus-5-5`.
- **FreeToken:** point it at your [FreeToken](https://github.com/varunkar2003/freetoken) server (default `http://localhost:3000/api/v1`) and paste an `ft_…` API token from FreeToken → Settings → API tokens. Chat and Ctrl+K use `auto-smart` (or any model it lists) and Tab uses `auto-fast`. FreeToken forwards tools and routes them to tool-capable free models, so Agent mode works too.

Keys and tokens are encrypted with the OS keychain via Electron `safeStorage`.

## Features

| Feature | How it works | Cursor equivalent (observed) |
|---|---|---|
| Agent chat | Streaming tool loop with Claude; tools run locally: read/list/grep/file search/codebase search/edit/write/delete/terminal/todos | `ChatService.StreamUnifiedChatWithTools` + `CLIENT_SIDE_TOOL_V2_*` |
| Ask mode | Same loop with read-only tools | `UNIFIED_MODE_CHAT` |
| Command approval | Every terminal command waits for Run/Skip | `RUN_TERMINAL_COMMAND_V2` approval |
| Review changes | Every file the agent touches is checkpointed; diff view, accept/reject per file or all | Composer review / "Accept all" |
| Ctrl+K inline edit | Selection + instruction → replacement → inline diff → Accept/Reject (undoable) | `CmdKService.StreamCmdK` |
| Tab completion | Ghost-text suggestions at the cursor, Tab to accept, toggle in the status bar | `CppService` ("Cursor Tab") |
| Codebase index | SHA-256 Merkle tree (re-index only re-chunks changed subtrees) + declaration-aware chunking + BM25 ranking | `RepositoryService` Merkle sync + server-side embeddings |
| Ignore files | `.gitignore` + `.cursorignore` (tree, search, AI); `.cursorindexingignore` (index only) | same files |
| Project rules | `.cursorrules`, `AGENTS.md`, `.cursor/rules/*.md(c)` go into the system prompt | `FETCH_RULES` |
| @-mentions, Ctrl+L | Attach files or the current selection to a chat message | same |
| Run your app + preview | "Run the app" → `run_app` starts it (approval) in the **App** panel (output + stdin box); any localhost URL it prints opens in the **Preview** pane, a sandboxed embedded browser. The agent checks it with `app_output` / `app_input` / `inspect_preview` (page text + console errors, plus a screenshot for Claude) | Cursor's browser preview / background terminals |
| Editor | Monaco with tabs, Ctrl+P quick open, Ctrl+Shift+F search (ripgrep), terminal panel (Ctrl+`) | VS Code workbench |

The code is split in two. The main process (`src/main`) owns the filesystem, ripgrep, the index, the API key and every Claude call. The renderer (`src/renderer`) is sandboxed and reaches the main process only through the `window.api` bridge in `src/preload`. Every path from the UI or the model is confined to the open folder.

## Tests

| Command | Proves |
|---|---|
| `npm test` | Path confinement, ignore rules, ripgrep, Merkle diff + BM25, the full agent loop (search → read → edit → create → approved command), rules + eager tool streaming + fallbacks sent to the API, reject/restore, declined commands, Ask-mode tool filtering, Cmd+K, Tab |
| `npx tsx test/freetoken.test.ts` | The FreeToken provider against a fake OpenAI-compatible server: model list, the full agent loop with streamed tool calls, OpenAI-format requests, review/reject, Ask filtering, Ctrl+K, Tab (`auto-fast`), bad-token/server-down/no-token messages. Set `FREETOKEN_LIVE_URL` and `FREETOKEN_LIVE_TOKEN` to also hit a real server |
| `npx tsx test/e2e-freetoken.ts` | The app switching to FreeToken in Settings, Test connection, the encrypted token, an agent task with "Run all" approval, "run the app" (a real web server shown in the Preview pane, its text + console errors sent back to the model, preview hidden under dialogs), and switching folders |
| `npm run e2e` | Launches the real Electron app (Playwright) and covers: tree, Monaco, save, quick open, Ctrl+K, Tab ghost text, agent with approval, live tab reload, review diff with reject/accept, Ask mode, @-mentions, search, terminal, encrypted key storage, no renderer errors |

Both suites run against `test/fake-anthropic.ts`, a scripted local server that speaks the real Messages API streaming format, so no API key or spend is needed. **They don't prove output quality with a real model.** Do that by adding your key and using the app.

## Not built

VS Code extensions, debugger, git UI, language servers beyond Monaco's built-ins, embeddings (BM25 stands in), background/cloud agents, MCP, multi-root workspaces, and a real PTY terminal (the panel runs one command at a time).
