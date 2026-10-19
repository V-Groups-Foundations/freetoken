#!/usr/bin/env bash
# FreeToken one-line installer for macOS / Linux:
#   curl -fsSL https://raw.githubusercontent.com/V-Groups-Foundations/freetoken/master/install.sh | bash
# Downloads FreeToken to ~/freetoken (git if you have it, otherwise a tarball), installs it, and starts
# it — your browser opens already signed in. Safe to run again: it updates and restarts.
set -euo pipefail
REPO="V-Groups-Foundations/freetoken"
DIR="${FREETOKEN_DIR:-$HOME/freetoken}"

printf '\n  \033[36mFreeToken by V Groups — free AI for everyone\033[0m\n\n'

if ! command -v node >/dev/null 2>&1 || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=9)?0:1)'; then
  echo "  FreeToken needs Node.js 20.9 or newer."
  echo "  Install it from https://nodejs.org (or: brew install node / your package manager),"
  echo "  then run this installer again."
  exit 1
fi

if [ -f "$DIR/package.json" ]; then
  echo "  Updating $DIR"
  if [ -d "$DIR/.git" ] && command -v git >/dev/null 2>&1; then git -C "$DIR" pull --ff-only; fi
elif command -v git >/dev/null 2>&1; then
  echo "  Downloading to $DIR"
  git clone --depth 1 "https://github.com/$REPO.git" "$DIR"
else
  echo "  Downloading to $DIR (tarball)"
  mkdir -p "$DIR"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/master" | tar -xz --strip-components=1 -C "$DIR"
fi

cd "$DIR"
echo "  Installing (about a minute)…"
npm install --no-audit --no-fund --loglevel=error
printf '\n  \033[32mStarting FreeToken — your browser will open, already signed in.\033[0m\n'
echo "  Next time: cd $DIR && npm run dev     (V-Run desktop app: npm run desktop)"
echo
exec npm run dev
