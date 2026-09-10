#!/bin/bash
# One-command setup — SIH26171.
#
#   ./setup.sh
#
# Gets a fresh clone to a working build. Safe to re-run: every step checks before it
# does anything, so a half-finished setup can just be run again.
set -u
cd "$(dirname "$0")"

. "$(cd "$(dirname "$0")" && pwd)/scripts/venv-bin.sh"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
ok()   { echo "  ${GREEN}✓${OFF} $1"; }
warn() { echo "  ${YELLOW}!${OFF} $1"; }
bad()  { echo "  ${RED}✗${OFF} $1"; }
step() { echo; echo "${BOLD}$1${OFF}"; }

PROBLEMS=0

step "1. Checking what you have"

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -ge 22 ]; then
    ok "node $(node -v)"
  else
    bad "node $(node -v) — need 22+ (we run TypeScript directly, no compile step)"
    PROBLEMS=$((PROBLEMS+1))
  fi
else
  bad "node not found — install Node 22+ from https://nodejs.org"
  PROBLEMS=$((PROBLEMS+1))
fi

if command -v python3 >/dev/null 2>&1; then
  ok "python $(python3 -V | cut -d' ' -f2)"
else
  bad "python3 not found"
  PROBLEMS=$((PROBLEMS+1))
fi

if command -v ollama >/dev/null 2>&1; then
  ok "ollama installed"
else
  warn "ollama not found — needed to RUN the agent, not to build or test it"
  warn "  install: https://ollama.com/download   (or: brew install ollama)"
fi

[ "$PROBLEMS" -gt 0 ] && { echo; bad "fix the above first"; exit 1; }

# CI has no Ollama and no GPU; the build and the whole test suite still must work.
[ -n "${CI:-}" ] && warn "CI detected — skipping anything that needs a GPU or Ollama"

step "2. Node dependencies"
if [ -d node_modules ]; then
  ok "node_modules present (delete it and re-run to refresh)"
else
  npm install --no-audit --no-fund >/dev/null 2>&1 && ok "installed" || { bad "npm install failed"; exit 1; }
fi

step "3. Models and runtime (~230MB, not in git)"
# Reproducible rather than committed: ONNX Runtime and the model weights together are
# far too large for a repo, and setup.mjs fetches exactly the ones the spikes chose.
# PIPESTATUS, not the pipeline's status: `node ... | sed` reports sed's exit code, so a
# failed download was reported as a successful setup and surfaced much later as a
# missing-file crash in the tests.
set -o pipefail
if node setup.mjs 2>&1 | sed 's/^/  /'; then
  ok "models and runtime ready"
else
  bad "setup.mjs failed — see the error above"
  exit 1
fi
set +o pipefail

step "4. Building the extension"
if node build.mjs >/tmp/sih-build.log 2>&1; then
  grep -E "dist/|aligned" /tmp/sih-build.log | sed 's/^/  /'
  ok "extension built"
else
  bad "build failed:"
  tail -20 /tmp/sih-build.log | sed 's/^/      /'
  exit 1
fi

step "5. Python server"
if [ -d server/.venv ]; then
  ok "virtualenv present"
else
  python3 -m venv server/.venv && ok "virtualenv created"
fi
# Check the exit status. This used to print success unconditionally, so on Windows -
# where the executables live in Scripts/, not bin/ - it reported installed
# dependencies that had never been installed.
PIP="$(venv_exe pip)" || { bad "no pip in the virtualenv"; exit 1; }
if "$PIP" install -q -r server/requirements.txt 2>&1 | tail -2; then
  ok "server dependencies installed"
else
  bad "pip install failed"
  PROBLEMS=$((PROBLEMS+1))
fi

step "6. The vision model (6GB — the slow part)"
if command -v ollama >/dev/null 2>&1; then
  # `ollama list` shows a model even when a pull was interrupted, so check that it
  # actually RUNS. A half-pulled model fails at demo time, not at setup time.
  if ollama list 2>/dev/null | grep -q "qwen2.5vl"; then
    # `ollama show` reads the manifest and blobs, which is what an interrupted pull
    # leaves broken. Deliberately not `timeout`: it is not installed on macOS by
    # default, so relying on it would make this check silently useless there.
    printf "  verifying the model is complete ... "
    if ollama show qwen2.5vl:7b >/dev/null 2>&1; then
      echo "${GREEN}ok${OFF}"
      ok "qwen2.5vl:7b present and usable"
    else
      bad "qwen2.5vl:7b is listed but does not run — the pull may be incomplete"
      echo "      re-pull it:  ollama rm qwen2.5vl:7b && ollama pull qwen2.5vl:7b"
    fi
  else
    warn "not pulled yet — 6GB. Starting it now; this is the long part."
    if ollama pull qwen2.5vl:7b; then
      ok "qwen2.5vl:7b pulled"
    else
      bad "pull failed. Re-run: ollama pull qwen2.5vl:7b"
    fi
  fi
else
  warn "skipped — ollama not installed (needed to RUN the agent, not to build or test)"
fi

step "7. Checking it works"
FAILED=0
for f in extension/src/pii/*.test.ts extension/src/content/*.test.ts \
         extension/src/agent/*.test.ts extension/src/vision/*.test.ts bench/leak-test.ts; do
  NAME=$(basename "$f")
  if node --experimental-strip-types "$f" >/dev/null 2>&1; then
    ok "$NAME"
  else
    bad "$NAME"
    FAILED=$((FAILED+1))
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "${GREEN}${BOLD}Setup complete.${OFF}"
else
  echo "${RED}${BOLD}$FAILED test file(s) failing.${OFF} Paste the output in the group."
fi

cat <<'NEXT'

WHAT TO DO NEXT
  Read ONBOARDING.md — it explains the project and what to pick up.

  Run everything          ./test-all.sh
  See the scorecard       node --experimental-strip-types bench/score.ts

  Load the extension:
    Chrome    chrome://extensions  -> Developer mode -> Load unpacked -> extension/
    Firefox   about:debugging -> Load Temporary Add-on -> dist-firefox/manifest.json

  Then start the server and open the side panel:
    cd server && .venv/bin/uvicorn main:app --port 8975

NEXT
