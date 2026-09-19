#!/usr/bin/env bash
#
# Update Aavaran — double-click this file.
#
# It pulls the latest code, rebuilds the extension, and restarts the reasoning server.
# You do not download anything from the releases page again after the first time.
#
# It installs nothing and it never touches your work: if you have local changes it
# stops and says so rather than throwing them away.
#
# First run on macOS: right-click → Open, not double-click. Anything extracted from a
# downloaded zip is quarantined by Gatekeeper, and right-click → Open is the consent
# step for that. After once, double-click works.
set -u
cd "$(dirname "$0")"

say()  { printf '\n  %s\n' "$*"; }
bye()  { say "Press return to close this window."; read -r _; exit "${1:-0}"; }

# ── 0. is this a clone, or an unzipped copy? ─────────────────────────────────
# An unzipped release has no git history, so there is nothing to pull and no way to
# update in place. Saying "run git pull" to somebody who has no repository is the same
# defect as telling them to `cd server` when the zip has no server directory.
if [ ! -d .git ]; then
  say "This folder is a downloaded copy, not a clone, so there is nothing to update from."
  say "To get automatic updates, clone the repository once instead:"
  echo
  echo "      git clone https://github.com/AavaranAI/Aavaran.git"
  echo "      cd Aavaran && ./setup.sh"
  echo
  say "Then load THAT folder in chrome://extensions, and run this file from inside it."
  say "You need access to the repo — ask Harsh if github says not found."
  bye 1
fi

command -v git >/dev/null 2>&1 || { say "git is not installed. Install Xcode command line tools: xcode-select --install"; bye 1; }

# ── 1. never destroy uncommitted work ────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
  say "You have uncommitted changes in this folder, so this is not going to pull over them."
  echo
  git status --short
  echo
  say "Commit or stash them first, then run this again."
  bye 1
fi

BEFORE=$(git rev-parse HEAD)

say "Fetching…"
if ! git pull --ff-only; then
  say "The pull did not fast-forward — your branch has diverged from the remote."
  say "Sort that out by hand; this script will not guess which side you want."
  bye 1
fi

AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  say "Already up to date — nothing changed."
else
  say "Updated:"
  echo
  git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/      /'
fi

# ── 2. rebuild, every time ───────────────────────────────────────────────────
# NOT only when the pull moved. A previous run may have failed halfway, or the person
# may have loaded the extension before ever building it — and a dist/ that is older
# than its source is this project's most repeated bug, not a rare one.
if ! command -v node >/dev/null 2>&1; then
  say "node is not installed, so the extension cannot be rebuilt."
  say "Install it from https://nodejs.org, then run this again."
  bye 1
fi

if [ ! -d node_modules ]; then
  say "Installing dependencies (first time only)…"
  npm install --silent || { say "npm install failed."; bye 1; }
fi

say "Rebuilding the extension…"
node build.mjs || { say "The build failed. Nothing was changed in Chrome — it is still running the last good build."; bye 1; }

# The Python side can gain dependencies too, and a server that will not start because
# of a missing package looks exactly like a server that is simply down.
if [ -x server/.venv/bin/pip ] && [ -f server/requirements.txt ]; then
  say "Checking the server's Python packages…"
  server/.venv/bin/pip install -q -r server/requirements.txt 2>/dev/null \
    || say "Could not update Python packages — the server may still be fine."
fi

# ── 3. restart the server, because it is the half that does NOT reload itself ─
# The extension is reloaded by Chrome. The server is a process somebody started days
# ago, and it goes on serving the old code with no sign anything is wrong. That silent
# mismatch is why /health now reports a version and the panel compares it.
if curl -s -m 2 http://127.0.0.1:8975/health >/dev/null 2>&1; then
  say "Stopping the old reasoning server…"
  # Match the exact command the launcher starts, so this cannot hit an unrelated
  # uvicorn somebody is running for something else.
  pkill -f 'uvicorn main:app --port 8975' 2>/dev/null || true
  for _ in $(seq 1 10); do
    curl -s -m 1 http://127.0.0.1:8975/health >/dev/null 2>&1 || break
    sleep 1
  done
fi

cat <<'TXT'

  ──────────────────────────────────────────────────────────────────
  ONE STEP LEFT, and Chrome will not do it for you:

      open  chrome://extensions
      press the ⟳ reload arrow on the Aavaran card

  Chrome also picks it up on its own if you quit and reopen Chrome.
  ──────────────────────────────────────────────────────────────────

TXT

if [ ! -x server/.venv/bin/uvicorn ]; then
  say "No Python environment yet — run ./setup.sh once if you want the agent."
  bye 0
fi

say "Starting the reasoning server on http://127.0.0.1:8975"
say "Leave this window open while you use the extension. Ctrl-C stops it."
echo
# --app-dir instead of a `cd`, so the command depends on no working directory.
exec server/.venv/bin/uvicorn main:app --port 8975 --app-dir server
