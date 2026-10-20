---
name: refactoring
description: "Refactor code safely without changing behavior: tests first, small verified steps, rename, extract, inline, move, remove duplication, simplify conditionals, and knowing when not to refactor. Use when the user asks to clean up, refactor, restructure, simplify, reorganize or split code."
---

# Refactoring

A refactor changes structure, never behavior. If behavior changes, it is a feature or a fix: do it
in a separate step.

## 1. Before touching code
1. State the goal in one sentence: "Split the 600-line `App.tsx` so each page is its own component."
2. Make sure behavior is pinned down: run existing tests and note the result. If the code has no tests,
   write characterization tests for the parts you will change (feed inputs, assert current outputs),
   or at least write down a manual check (command + expected output, or pages to click through).
3. Check git state: `git status` clean or committed, so every step can be undone (`git diff` shows it).

## 2. Work in small steps
Each step: one change, then run tests / the check, then continue. If something breaks, undo that
step (`git restore <file>`) rather than debugging a large diff. Commit after a few green steps.

## 3. The core moves
- **Rename** to say what it is: `data` -> `invoices`, `handle()` -> `sendReminderEmail()`. Update every
  usage (search with grep including strings, tests and docs; use the editor's rename when possible).
- **Extract function/component:** a block with a comment explaining it, or repeated 3+ times, becomes a
  named function. Pass what it needs as parameters; return the result instead of mutating.
- **Inline:** a wrapper that adds nothing gets removed.
- **Move:** put code next to what uses it (feature folders); shared utilities in `lib/`/`utils/`.
- **Replace conditionals:** early returns instead of nested ifs; a lookup object instead of a long
  switch on strings; guard clauses at the top.
- **Remove duplication:** only when the duplicates change for the same reason. Two similar-looking
  blocks with different reasons to change can stay separate (wait for the third copy).
- **Delete dead code:** unused functions, flags, commented-out blocks. Confirm unused with grep first.
- **Introduce types** (TypeScript types, Python type hints) at boundaries to make data shapes explicit.

Example (guard clauses):
```js
// before
function price(user, cart) {
  if (user) { if (cart.items.length > 0) { return total(cart) * (user.vip ? 0.9 : 1); } else { return 0; } }
  else { throw new Error('no user'); }
}
// after
function price(user, cart) {
  if (!user) throw new Error('no user');
  if (cart.items.length === 0) return 0;
  const discount = user.vip ? 0.9 : 1;
  return total(cart) * discount;
}
```

## 4. Keep behavior identical
- Same inputs, same outputs, same errors, same side effects, same order of side effects.
- Watch for: changed default values, `==` vs `===`, falsy checks (`if (x)` vs `x != null` for 0 and ''),
  async ordering, mutated shared objects, changed public names (exports, API fields, CSS classes used
  elsewhere, DB columns).
- Keep public APIs stable; if a rename is needed, keep the old name as a deprecated alias.

## 5. When not to refactor
- No way to verify behavior and no time to add tests.
- Code that works, rarely changes and nobody needs to read.
- In the middle of an urgent fix (fix first, refactor after).
- Rewriting from scratch to "clean up": almost always loses edge cases. Refactor incrementally.
- Purely stylistic churn (reordering, reformatting) mixed into a functional change.

## Check before you finish
1. Full test suite passes, same count as before (quote the summary). Type check / build passes
   (`npx tsc --noEmit`, `npm run build`, `python -m pytest`).
2. Run the app (run_app) and exercise the touched paths; inspect_preview for UI code: no console errors,
   same visible result.
3. `git diff --stat` matches the stated goal; no unrelated changes.
4. Summarize what moved where in your reply.

## Common mistakes
- Refactor and behavior change in the same diff.
- Big-bang rewrites; skipping tests between steps.
- Premature abstractions (generic helpers with 6 options used once).
- Missing a usage in strings, dynamic imports, templates or other files when renaming.
