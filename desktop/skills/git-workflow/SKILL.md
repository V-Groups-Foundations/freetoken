---
name: git-workflow
description: "Use git well: review status and diff before committing, small focused commits with good messages, branches, .gitignore, undoing safely (restore, revert vs reset), never force-pushing shared branches, resolving merge conflicts, and GitHub CLI for pull requests. Use when the user asks to commit, push, branch, merge, undo changes, fix a conflict, or open a PR."
---

# Git workflow

Git is the safety net. Look before every write operation, and prefer commands that can be undone.

## 1. Look first
```powershell
git status            # what changed, which branch, ahead/behind
git diff              # unstaged changes
git diff --staged     # what will be committed
git log --oneline -10 # recent history
git branch --show-current
```
Commit or push only when the user asked. If the repo has no commits yet or no git at all, `git init`
only when asked.

## 2. Commits
- One logical change per commit. Stage specific files: `git add src/auth.ts src/auth.test.ts`, or
  hunks with `git add -p`. Avoid `git add .` unless you reviewed the full `git status`.
- Never commit secrets (.env, keys), build output, `node_modules`, `.venv`, large binaries. Check
  `git diff --staged` before committing.
- Message: imperative subject under ~60 characters, then a blank line and the *why* if not obvious.
```
Fix duplicate invoice numbers under concurrent saves

Two requests could read the same max(number). Use a DB sequence instead.
```
  Follow the repo's existing convention (e.g. Conventional Commits `feat:`, `fix:`) if it has one.
- Multi-line messages in PowerShell: `git commit -m "Subject" -m "Body paragraph"`.

## 3. Branches
- Do not work directly on `main` for features: `git switch -c feat/csv-export`.
- Names: `feat/...`, `fix/...`, `chore/...`, lowercase-hyphenated.
- Update from main: `git fetch` then `git rebase origin/main` (own, unpushed branch) or
  `git merge origin/main` (shared branch).
- Delete merged branches: `git branch -d feat/csv-export`.

## 4. .gitignore essentials
```
node_modules/
dist/
.next/
.venv/
__pycache__/
.env
.env.*
!.env.example
*.log
.DS_Store
Thumbs.db
```
Already-tracked files are not ignored: `git rm --cached .env` then commit. If a secret was ever
pushed, tell the user to rotate it; removing it from history is not enough.

## 5. Undoing safely
| Situation | Command |
|---|---|
| Discard unstaged changes in a file | `git restore path` |
| Unstage a file | `git restore --staged path` |
| Fix last commit message (not pushed) | `git commit --amend -m "New message"` |
| Undo last commit, keep changes (not pushed) | `git reset --soft HEAD~1` |
| Undo a pushed commit | `git revert <sha>` (new commit, history kept) |
| Find lost commits | `git reflog` |
| Park work temporarily | `git stash push -m "wip"` / `git stash pop` |
- `git reset --hard`, `git clean -fd` and `git checkout -- .` destroy uncommitted work: run them only when
  the user explicitly wants that, after showing what will be lost.
- Never `git push --force` to `main` or any shared branch. On your own branch after a rebase use
  `git push --force-with-lease`.

## 6. Resolving conflicts
1. `git status` lists conflicted files. Open each and find `<<<<<<<`, `=======`, `>>>>>>>`.
2. Understand both sides (`git log --merge -p path` shows the commits); keep the correct combined
   result, not just one side by reflex. Remove all markers.
3. Run the build/tests, then `git add path` and `git merge --continue` (or `git rebase --continue`).
4. To bail out: `git merge --abort` / `git rebase --abort`.
5. Check nothing is left: `git diff --check` and search for `<<<<<<<`.

## 7. GitHub CLI
```powershell
gh auth status
git push -u origin feat/csv-export
gh pr create --title "Add CSV export" --body "What changed, why, how to test."
gh pr view --web
gh pr checks
gh pr merge --squash --delete-branch
```
PR body: what changed, why, how it was tested, screenshots for UI. Keep PRs small (under ~400 lines).

## Check before you finish
1. `git status` is clean (or only intended untracked files remain).
2. `git log --oneline -3` shows the expected commits with clear messages.
3. Tests/build pass on the committed state.
4. If pushed: `git status` reports "up to date with origin/...".

## Common mistakes
- Committing without reading the staged diff; "update" or "fix stuff" messages.
- Giant mixed commits (feature + formatting + refactor).
- Force-pushing shared branches; `reset --hard` with uncommitted work.
- Resolving conflicts by accepting one side everywhere without testing.
