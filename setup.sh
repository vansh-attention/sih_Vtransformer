#!/bin/bash
# One-command setup — SIH26171.
#
#   ./setup.sh
#
# Gets a fresh clone to a working build. Safe to re-run: every step checks before it
# does anything, so a half-finished setup can just be run again.
set -u
cd "$(dirname "$0")"

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

step "2. Node dependencies"
if [ -d node_modules ]; then
  ok "node_modules present (delete it and re-run to refresh)"
else
  npm install --no-audit --no-fund >/dev/null 2>&1 && ok "installed" || { bad "npm install failed"; exit 1; }
fi

step "3. Models and runtime (~230MB, not in git)"
# Reproducible rather than committed: ONNX Runtime and the model weights together are
# far too large for a repo, and setup.mjs fetches exactly the ones the spikes chose.
node setup.mjs 2>&1 | sed 's/^/  /'

step "4. Building the extension"
node build.mjs 2>&1 | grep -E "dist/|aligned" | sed 's/^/  /'

step "5. Python server"
if [ -d server/.venv ]; then
  ok "virtualenv present"
else
  python3 -m venv server/.venv && ok "virtualenv created"
fi
./server/.venv/bin/pip install -q -r server/requirements.txt 2>&1 | tail -2
ok "server dependencies installed"

step "6. The vision model (6GB — the slow part)"
if command -v ollama >/dev/null 2>&1; then
  if ollama list 2>/dev/null | grep -q "qwen2.5vl"; then
    ok "qwen2.5vl:7b already pulled"
  else
    warn "not pulled yet. This is a 6GB download; start it now and let it run:"
    echo "      ollama pull qwen2.5vl:7b"
  fi
else
  warn "skipped — ollama not installed"
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

  Run the tests           ./bench/failure-drills.sh
  See the scorecard       node --experimental-strip-types bench/score.ts
  Try the agent           see ONBOARDING.md "Running it for real"

NEXT
