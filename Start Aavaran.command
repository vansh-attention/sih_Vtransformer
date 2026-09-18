#!/usr/bin/env bash
#
# Start Aavaran — double-click this file.
#
# It STARTS things. It NEVER installs anything, and it is kept short enough that you
# can read all of it in under a minute before trusting it. That is deliberate: this
# project's whole argument is that you should not have to take our word for anything,
# and a launcher you cannot read is exactly the thing a careful person refuses to run.
#
# First run on macOS: right-click → Open, not double-click. Anything extracted from a
# downloaded zip is quarantined by Gatekeeper, and right-click → Open is the consent
# step for that. After once, double-click works.
set -u
cd "$(dirname "$0")"

say() { printf '\n  %s\n' "$*"; }

# ── 1. ollama ────────────────────────────────────────────────────────────────
# Not installed is a STOP, not something to fix silently. Installing a background
# daemon on somebody's machine without asking is precisely what we tell people to be
# suspicious of, so this opens the download page and lets them decide.
if ! command -v ollama >/dev/null 2>&1; then
  say "ollama is not installed — it is the one piece you have to install yourself."
  say "Opening https://ollama.com/download ; install it, then run this again."
  open "https://ollama.com/download" 2>/dev/null || true
  say "Press return to close this window."; read -r _; exit 1
fi

if curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  say "ollama is already running."
else
  say "Starting ollama…"
  nohup ollama serve >/tmp/aavaran-ollama.log 2>&1 &
  for _ in $(seq 1 20); do
    curl -s -m 1 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1
  done
fi

# ── 2. the reasoning server ──────────────────────────────────────────────────
# setup.sh builds this venv. Without it there is nothing to run, and saying so beats
# a Python traceback.
if [ ! -x server/.venv/bin/uvicorn ]; then
  say "No Python environment yet. Run ./setup.sh once, then run this again."
  say "Press return to close this window."; read -r _; exit 1
fi

if curl -s -m 2 http://127.0.0.1:8975/health >/dev/null 2>&1; then
  say "The reasoning server is already running. Nothing to do — you can close this."
  say "Press return to close this window."; read -r _; exit 0
fi

say "Starting the reasoning server on http://127.0.0.1:8975"
say "Leave this window open while you use the extension. Ctrl-C stops it."
echo
# --app-dir instead of a `cd`: the command then depends on no working directory, which
# is what made the panel's old copy-pasteable instructions fail.
exec server/.venv/bin/uvicorn main:app --port 8975 --app-dir server
