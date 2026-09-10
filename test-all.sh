#!/bin/bash
# Run everything — SIH26171.
#
#   ./test-all.sh            unit tests, benchmarks, drills  (no browser needed)
#   ./test-all.sh --full     the above PLUS the browser spikes and the live model
#
# The default is what you run before every commit. --full is what you run before the
# internal hackathon and before the finale: it launches real browsers and needs the
# model server up.
set -u
cd "$(dirname "$0")"

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

BOLD=$'\033[1m'; GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
PASS=0; FAIL=0; SKIP=0
FAILED_NAMES=""

run() {   # $1 = label, rest = command
  local label="$1"; shift
  local out
  if out=$("$@" 2>&1); then
    echo "  ${GREEN}✓${OFF} $label"
    PASS=$((PASS+1))
  else
    echo "  ${RED}✗${OFF} $label"
    echo "$out" | tail -6 | sed 's/^/      /'
    FAIL=$((FAIL+1))
    FAILED_NAMES="$FAILED_NAMES\n      $label"
  fi
}

skip() { echo "  ${DIM}– $1 ${2:-}${OFF}"; SKIP=$((SKIP+1)); }

section() { echo; echo "${BOLD}$1${OFF}"; }

NODE="node --experimental-strip-types"

# ---------------------------------------------------------------------------
section "Build"
run "extension builds (and manifests agree)" node build.mjs

section "Unit tests"
for f in extension/src/pii/checksums.test.ts \
         extension/src/pii/dom.test.ts \
         extension/src/pii/names.test.ts \
         extension/src/content/extractor.test.ts \
         extension/src/agent/validate.test.ts \
         extension/src/vision/faces.test.ts; do
  run "$(basename "$f")" $NODE "$f"
done

section "Privacy invariants"
run "leak test — no vault value in any payload"  $NODE bench/leak-test.ts
run "prompt injection — hostile page defences"   $NODE bench/injection-test.ts

section "Scorecard"
run "tuned corpus"    $NODE bench/score.ts
run "HOLDOUT corpus"  $NODE bench/score.ts --holdout

section "User journeys"
run "odd input, repeat runs, pathological content" $NODE bench/user-journey.ts

section "Robustness"
run "real websites survive the pipeline"  $NODE bench/realpages-drill.ts
run "huge page stays in budget"           $NODE bench/huge-page-drill.ts

section "Failure drills"
if [ -x server/.venv/bin/uvicorn ]; then
  run "server faults and edge cases" ./bench/failure-drills.sh
else
  skip "failure drills" "(no server venv — run ./setup.sh)"
fi

# ---------------------------------------------------------------------------
if [ "$FULL" -eq 1 ]; then
  section "Browser spikes (real browsers — slow)"

  CFT="/tmp/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  if [ -f "$CFT" ]; then
    run "Spike C+D — capture alignment & face redaction" ./spikes/c-capture/run.sh
    if curl -s http://127.0.0.1:8975/health >/dev/null 2>&1; then
      run "Spike E — full agent loop in Chrome" ./spikes/e-e2e/run.sh
    else
      skip "Spike E" "(model server not running on :8975)"
    fi
    run "Spike G — throttled slow-machine timings" ./spikes/g-slow-machine/run.sh
  else
    skip "Chrome spikes" "(Chrome for Testing not at /tmp/chrome-mac-arm64)"
  fi

  if [ -f "/Volumes/Firefox/Firefox.app/Contents/MacOS/firefox" ]; then
    run "Spike F — extension loads and runs in Firefox" ./spikes/f-firefox-ext/run.sh
  else
    skip "Spike F" "(Firefox not mounted at /Volumes/Firefox)"
  fi

  section "Live model"
  if curl -s http://127.0.0.1:8975/health 2>/dev/null | grep -q '"ok":true'; then
    run "end-to-end agent loop against the real model" \
        $NODE bench/agent-loop.ts "Submit the payment form"
  else
    skip "live agent loop" "(server not ready — cd server && .venv/bin/uvicorn main:app --port 8975)"
  fi
else
  echo
  echo "${DIM}Browser spikes and the live model are skipped. Run ./test-all.sh --full${OFF}"
fi

# ---------------------------------------------------------------------------
echo
echo "${BOLD}────────────────────────────────${OFF}"
if [ "$FAIL" -eq 0 ]; then
  echo "${GREEN}${BOLD}$PASS passed${OFF}, $SKIP skipped"
else
  echo "${RED}${BOLD}$FAIL FAILED${OFF}, $PASS passed, $SKIP skipped"
  printf "%b\n" "$FAILED_NAMES"
fi
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
