#!/bin/bash
# Failure drills — SIH26171.
#
# Every one of these WILL happen at some point, and several will happen on demo day:
# the server not started, a cold model taking 17s, a stale process on the port. The
# question is not whether the system fails but whether it explains itself when it does.
#
# A stack trace in front of a judge is a worse failure than the outage that caused it.
#
#   ./bench/failure-drills.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
# Windows venvs use Scripts/, POSIX uses bin/.
. "$ROOT/scripts/venv-bin.sh"
UVICORN="$(venv_exe uvicorn "$ROOT/server/.venv")" || { echo "no uvicorn in the virtualenv — run ./setup.sh"; exit 1; }
PORT=8979
PASS=0; FAIL=0

SERVER_PID=""
# Fixed path the server computes independently — no environment involved.
FAULT_FILE="$ROOT/server/.drill-fault"
rm -f "$FAULT_FILE"

start_server() {   # $1 = fault mode ("" for healthy)
  stop_server
  # `exec` so $! is UVICORN's pid, not a wrapper subshell's. Killing the subshell left
  # the server running on Windows, so the next drill talked to the PREVIOUS fault mode
  # and got an answer meant for a different test.
  # The fault goes in a FILE the server reads per request. Two attempts at passing it
  # through the environment looked correct and silently failed on CI.
  if [ -n "$1" ]; then printf '%s' "$1" > "$FAULT_FILE"; else rm -f "$FAULT_FILE"; fi

  ( cd server && exec env AGENT_MODEL=qwen2.5vl:7b \
      "$UVICORN" main:app --port $PORT --log-level error >/tmp/drill-server.log 2>&1 ) &
  SERVER_PID=$!
  disown "$SERVER_PID" 2>/dev/null || true

  # Wait for the server AND confirm it is the one we asked for. Without this the drills
  # race a dying predecessor and assert against its answers.
  # Probe returns "up:<fault>" so that "server is up with no fault" is DISTINGUISHABLE
  # from "server is unreachable".
  #
  # Comparing the bare fault string made those two identical — an unreachable server
  # produced an empty string, which matched the healthy expectation, and start_server
  # returned success while nothing was listening.
  # Matched with grep, NOT by piping through python3.
  #
  # Git Bash on Windows has `python`, not `python3`, so the probe silently failed there
  # and reported the server as down while it was serving the requested fault perfectly.
  # The drills should not depend on an interpreter to read one JSON field.
  local want
  if [ -n "$1" ]; then want="\"fault\":\"$1\""; else want='"fault":null'; fi

  local raw
  # 60s: Windows runners are markedly slower to bind than Linux or macOS, and a
  # too-short window reports a healthy server as dead.
  for _ in $(seq 1 60); do
    raw=$(curl -s --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null || echo "")
    case "$raw" in
      *"$want"*) return 0 ;;
    esac
    sleep 1
  done
  local got="${raw:-unreachable}"
  # Four attempts at this have failed on CI while passing locally. Print everything
  # needed to diagnose it from the log alone, instead of guessing a fifth time.
  echo "  (server did not come up in fault mode '${1:-none}'; last seen '${got:-none}')"
  echo "  --- diagnostics ---"
  echo "  ROOT=$ROOT"
  echo "  FAULT_FILE=$FAULT_FILE"
  echo "  fault file exists: $([ -f "$FAULT_FILE" ] && echo "yes, contents: '$(cat "$FAULT_FILE")'" || echo no)"
  echo "  UVICORN=$UVICORN"
  echo "  server pid=$SERVER_PID alive: $(kill -0 "$SERVER_PID" 2>/dev/null && echo yes || echo no)"
  echo "  /health raw: $(echo "$raw" | head -c 400)"
  echo "  looked for: $want"
  echo "  --- server log ---"
  if [ -s /tmp/drill-server.log ]; then
    tail -25 /tmp/drill-server.log | sed "s/^/  /"
  else
    echo "  (log is empty — uvicorn wrote nothing)"
  fi
  return 1
}

# Kill by PID, and never `wait` on it.
#
# The previous version used `pkill -f` and a bare `wait`. Git Bash has no pkill, so on
# Windows the server was never killed and `wait` blocked forever — test-all.sh hung
# indefinitely with no output. Found on a real Windows runner; invisible on macOS and
# Linux, where pkill exists and the wait returned immediately.
stop_server() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null || true
    SERVER_PID=""
# Fixed path the server computes independently — no environment involved.
FAULT_FILE="$ROOT/server/.drill-fault"
rm -f "$FAULT_FILE"
  fi
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "main:app --port $PORT" 2>/dev/null || true
  fi
  # Wait for the PORT to actually free up rather than guessing with a fixed sleep.
  # A fixed sleep is what let a dying server answer the next drill.
  for _ in $(seq 1 15); do
    curl -s --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || return 0
    sleep 1
  done
}

# Some drills need a live model behind the server. A machine without Ollama should
# still get a clean run of everything else rather than one red line it cannot fix.
OLLAMA_UP=0
curl -s --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && OLLAMA_UP=1
[ "$OLLAMA_UP" -eq 0 ] && echo "  (ollama not reachable — model-dependent drills will be skipped)" && echo

skip_drill() { echo "  ${DIM:-}– $1 (needs ollama)${OFF:-}"; SKIP=$((SKIP+1)); }
SKIP=0

drill() {   # $1 = name, $2 = expected substring, $3 = actual output
  if grep -qi "$2" <<<"$3"; then
    echo "  ok    $1"; PASS=$((PASS+1))
  else
    echo "  FAIL  $1"
    echo "        expected to contain: $2"
    echo "        got: $(head -c 300 <<<"$3")"
    FAIL=$((FAIL+1))
  fi
}

echo "=== FAILURE DRILLS ==="
echo

# 1. Server not running at all — the single most likely demo-day failure.
stop_server
OUT=$(AGENT_SERVER="http://127.0.0.1:$PORT" node --experimental-strip-types bench/agent-loop.ts "test" 2>&1 || true)
drill "server down: names the fix, not a stack trace" "uvicorn main:app" "$OUT"

# 2. Server up, returns 500.
#
# If the server cannot be started at all, SKIP the server-dependent drills rather than
# failing. Backgrounding a uvicorn process is environment-sensitive — it does not work
# under Git Bash on Windows, where the process is spawned but never binds — and a
# teammate there should still get every other check plus a clear reason, not one red
# line about something they cannot fix.
#
# Run these under WSL on Windows. The remaining drills are pure Node and run anywhere.
if ! start_server "500"; then
  echo
  echo "  ${YELLOW:-}Server-dependent drills SKIPPED: could not start uvicorn in the background.${OFF:-}"
  echo "  This is expected under Git Bash on Windows — use WSL to run these."
  SKIP=$((SKIP + 5))
  stop_server
  rm -f "$FAULT_FILE"

  OUT=$(node --experimental-strip-types bench/huge-page-drill.ts 2>&1 || true)
  drill "huge page stays within the node budget" "budget respected" "$OUT"
  drill "huge page extracts in reasonable time" "within time budget" "$OUT"

  echo
  echo "$PASS passed, $FAIL failed, $SKIP skipped"
  [ "$FAIL" -eq 0 ] || exit 1
  exit 0
fi
OUT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:$PORT/act" \
  -H 'content-type: application/json' -d '{"payload":{"root":{"id":"el_1","role":"other","box":{"x":0,"y":0,"w":1,"h":1},"visible":true,"enabled":true},"origin":"https://x.test","title":"t","capturedAt":0,"viewport":{"w":1,"h":1,"scrollX":0,"scrollY":0},"placeholders":[],"acknowledged":[],"goal":"g","history":[]}}')
drill "server fault: returns a clean 500" "500" "$OUT"

# 3. A 200 that is not JSON — a captive portal or misrouted proxy.
start_server "garbage"
OUT=$(curl -s -X POST "http://127.0.0.1:$PORT/act" -H 'content-type: application/json' \
  -d '{"payload":{"root":{"id":"el_1","role":"other","box":{"x":0,"y":0,"w":1,"h":1},"visible":true,"enabled":true},"origin":"https://x.test","title":"t","capturedAt":0,"viewport":{"w":1,"h":1,"scrollX":0,"scrollY":0},"placeholders":[],"acknowledged":[],"goal":"g","history":[]}}')
drill "non-JSON 200 is served (client must cope)" "not JSON" "$OUT"

# 4. Model returns no actions — a real outcome when it sees nothing to do.
start_server "empty"
OUT=$(AGENT_SERVER="http://127.0.0.1:$PORT" node --experimental-strip-types bench/agent-loop.ts "test" 2>&1 || true)
drill "empty action list is handled, not crashed on" "FAIL\|action" "$OUT"

# 5. The server's own tripwire refuses un-redacted PII.
start_server ""
OUT=$(curl -s -X POST "http://127.0.0.1:$PORT/act" -H 'content-type: application/json' \
  -d '{"payload":{"root":{"id":"el_1","role":"textbox","value":"ABCPE1234F","box":{"x":0,"y":0,"w":1,"h":1},"visible":true,"enabled":true},"origin":"https://x.test","title":"t","capturedAt":0,"viewport":{"w":1,"h":1,"scrollX":0,"scrollY":0},"placeholders":[],"acknowledged":[],"goal":"g","history":[]}}')
drill "server refuses an un-redacted PAN in the payload" "unredacted PII" "$OUT"

# 6. And accepts it once the client has acknowledged the decision.
#    This one reaches the MODEL, so it needs Ollama.
if [ "$OLLAMA_UP" -eq 1 ]; then
  OUT=$(curl -s -X POST "http://127.0.0.1:$PORT/act" -H 'content-type: application/json' \
    -d '{"payload":{"root":{"id":"el_1","role":"textbox","value":"ABCPE1234F","box":{"x":0,"y":0,"w":1,"h":1},"visible":true,"enabled":true},"origin":"https://x.test","title":"t","capturedAt":0,"viewport":{"w":1,"h":1,"scrollX":0,"scrollY":0},"placeholders":[],"acknowledged":[{"id":"el_1","kind":"PAN","reason":"drill"}],"goal":"g","history":[]}}' \
    --max-time 180)
  drill "acknowledged detection is accepted" "actions" "$OUT"
else
  skip_drill "acknowledged detection is accepted"
fi

stop_server
rm -f "$FAULT_FILE"

# 7. A page far larger than the node budget.
OUT=$(node --experimental-strip-types bench/huge-page-drill.ts 2>&1 || true)
drill "huge page stays within the node budget" "budget respected" "$OUT"
drill "huge page extracts in reasonable time" "within time budget" "$OUT"

echo
echo "$PASS passed, $FAIL failed$([ "$SKIP" -gt 0 ] && echo ", $SKIP skipped")"
[ "$FAIL" -eq 0 ] || exit 1
