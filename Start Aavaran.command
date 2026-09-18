#!/usr/bin/env bash
#
# Start Aavaran — double-click this file.
#
# It starts ollama and the reasoning server. It installs NOTHING without asking you
# first, in writing, with the exact command it would run, the disk cost, and what still
# works if you decline. The default answer is No.
#
# It is kept short enough to read in under a minute before you trust it. That is
# deliberate: this project's whole argument is that you should not have to take our word
# for anything, and a launcher you cannot read is exactly what a careful person refuses
# to run.
#
# First run on macOS: right-click → Open, not double-click. Anything extracted from a
# downloaded zip is quarantined by Gatekeeper, and right-click → Open is the consent
# step for that. After once, double-click works.
set -u
cd "$(dirname "$0")"

say() { printf '\n  %s\n' "$*"; }

# ── 1. ollama ────────────────────────────────────────────────────────────────
# OFFERED, NEVER ASSUMED.
#
# Silently installing a background daemon is what we tell people to be suspicious of.
# Saying nothing and sending them away is not better — they then do not know what they
# are missing. So: state what it is for, state exactly what will run, state what still
# works if they decline, and default to No.
if ! command -v ollama >/dev/null 2>&1; then
  cat <<'TXT'

  ollama is not installed.

  WHAT IT IS FOR
    Aavaran uses it to run the language model on your own machine, rather than
    sending your screen to somebody's cloud. It is required for "Run on this tab" —
    the agent that fills in a form for you.

  WHAT IT COSTS ON DISK
    ollama itself        ~0.5 GB
    the model            ~6.0 GB   (one download, kept, never fetched again)
    total                ~6.5 GB

  IF YOU SAY NO
    "Scan this page" still works, needs nothing, and is the whole privacy
    demonstration: it shows every personal value found and what would be sent
    instead. Only the agent is unavailable.

    You can install it later at any time — see INSTALL-OLLAMA.txt in this folder,
    which also covers removing it again.

TXT
  if command -v brew >/dev/null 2>&1; then
    cat <<'TXT'
  IF YOU SAY YES, exactly this runs and nothing else:

      brew install ollama

TXT
    printf '  Install ollama now? [y/N] '
    read -r reply
    case "$reply" in
      [yY]*)
        say "Running: brew install ollama"
        brew install ollama || { say "Install failed. Try https://ollama.com/download"; \
          say "Press return to close."; read -r _; exit 1; }
        hash -r   # bash caches command lookups; without this it may not see the new binary
        command -v ollama >/dev/null 2>&1 || {
          say "Install reported success but ollama is still not on PATH."
          say "Open a new terminal, or install from https://ollama.com/download"
          say "Press return to close."; read -r _; exit 1; }
        ;;
      *)
        say "Not installing. Scan still works — load the extension and press Scan."
        say "To install later, see INSTALL-OLLAMA.txt in this folder."
        say "Press return to close this window."; read -r _; exit 0
        ;;
    esac
  else
    # No Homebrew, so the honest path is the signed installer from ollama themselves.
    # A .dmg cannot be installed unattended in a way anyone should trust.
    say "Homebrew is not installed, so this cannot do it for you."
    say "Download the installer from https://ollama.com/download, then run this again."
    say "Full instructions, sizes and how to remove it: INSTALL-OLLAMA.txt in this folder."
    printf '  Open that page now? [Y/n] '
    read -r reply
    case "$reply" in [nN]*) : ;; *) open "https://ollama.com/download" 2>/dev/null || true ;; esac
    say "Press return to close this window."; read -r _; exit 1
  fi
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
