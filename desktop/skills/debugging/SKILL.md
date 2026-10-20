---
name: debugging
description: "Debug systematically: read the error, reproduce, locate, form one hypothesis, test it cheaply, fix the root cause and verify, with common Node, Python and browser error patterns and using logs and the browser console via inspect_preview. Use when something is broken, crashes, throws an error, shows a blank page, fails a test or behaves unexpectedly."
---

# Debugging

Do not guess and retry. Every step either gathers evidence or tests one hypothesis.

## The loop
1. **Read the whole error.** Message, type, file:line of the top frame in *your* code (skip
   node_modules/site-packages frames). Quote it to yourself; most errors say exactly what is wrong.
2. **Reproduce.** Find the exact command, request or click sequence that triggers it. If you cannot
   reproduce it, you cannot verify a fix. Make the repro as small and fast as possible.
3. **Locate.** Open the file at the reported line (read only that region). Trace the bad value
   backwards: where did it come from? Use grep to find definitions and callers.
4. **One hypothesis.** State it in one sentence: "`user` is undefined because the fetch has not resolved
   when the component renders."
5. **Cheapest test.** A log line, a print of the value and its type, a one-line script, a single test,
   a curl request. Change one thing at a time.
6. **Fix the root cause**, not the symptom. A `?.` or `try/except: pass` that hides the error is not a fix
   unless the value is legitimately optional.
7. **Verify** with the same repro, then run related tests. Remove debug logs.
If two hypotheses fail, step back: re-read the error, check assumptions (right file? right process?
saved? restarted? right env?), and look at what changed recently (`git diff`, `git log -5`).

## Where to look
- Server: the run_app output / terminal where it runs. Add structured logs at boundaries
  (request in, DB result, response out).
- Browser: inspect_preview to read the console errors, failed network requests and the rendered page.
  A blank page almost always has a console error.
- Tests: run one test with verbose output (`npx vitest run file -t name`, `python -m pytest path::test -x -vv`).
- Python: `breakpoint()` or `print(repr(x), type(x))`. Node: `console.log(JSON.stringify(x, null, 2))`
  or `node --inspect`.

## Common patterns
**Node / JS**
- `Cannot read properties of undefined (reading 'x')`: value not loaded yet, wrong property path, or
  an API returned a different shape. Log the object one level up.
- `X is not a function`: wrong import (default vs named), circular import, or ESM/CommonJS mismatch.
- `ERR_MODULE_NOT_FOUND` / `Cannot find module`: missing `npm install`, wrong relative path, missing
  `.js` extension in ESM, or `"type": "module"` mismatch.
- `EADDRINUSE :3000`: another process holds the port. PowerShell:
  `Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess` then stop it, or use another port.
- Unhandled promise rejection / missing `await`: value is a Promise, not data.
**Python**
- `ModuleNotFoundError`: venv not activated or package not installed in it (`python -m pip install ...`),
  or running from the wrong directory (use `python -m package.module`).
- `KeyError` / `AttributeError: 'NoneType'`: a lookup returned nothing; check the data, not just the code.
- `IndentationError`, mixed tabs/spaces; `TypeError: missing argument`: signature changed.
**Browser**
- CORS error: the server must send `Access-Control-Allow-Origin` for that origin (fix the server or use a
  dev proxy); it is not a frontend bug.
- 404 on assets: wrong base path or file not built. Mixed content: http resource on https page.
- React "Too many re-renders" / effect loops: state set during render, or unstable effect dependencies.
- Hydration mismatch: render output differs between server and client (dates, random, window).
**General**
- "Works on my machine": env var missing, different versions (`node -v`, `python --version`), stale cache
  (delete `.next`, `node_modules/.vite`, `__pycache__`), file not saved, server not restarted.
- Windows paths: backslashes in strings, case sensitivity on deploy (Linux), CRLF line endings in shell scripts.

## Check before you finish
1. The original repro now succeeds; quote the output.
2. Related tests pass; add a regression test when the bug was in logic.
3. Debug logging and temporary code removed.
4. Explain the root cause in one sentence in your reply.

## Common mistakes
- Changing several things at once, so you do not know what fixed it.
- Fixing the line in the stack trace instead of where the bad value was created.
- Silencing errors with broad try/catch.
- Declaring it fixed without re-running the repro.
