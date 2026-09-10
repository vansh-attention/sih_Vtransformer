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
VENV="$ROOT/server/.venv/bin"
PORT=8979
PASS=0; FAIL=0

start_server() {   # $1 = fault mode ("" for healthy)
  stop_server
  ( cd server && AGENT_MODEL=qwen2.5vl:7b AGENT_FAULT="$1" \
      "$VENV/uvicorn" main:app --port $PORT --log-level error >/tmp/drill-server.log 2>&1 &
    disown ) 2>/dev/null
  for _ in $(seq 1 20); do
    curl -s "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
stop_server() {
  # `disown` + redirect: without it bash prints "Terminated: 15" job notices between
  # drills, which read as failures in output that is meant to be scanned quickly.
  pkill -f "uvicorn main:app --port $PORT" 2>/dev/null
  wait 2>/dev/null
  sleep 1
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
start_server "500" || { echo "  (could not start server)"; exit 1; }
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

# 7. A page far larger than the node budget.
OUT=$(node --experimental-strip-types bench/huge-page-drill.ts 2>&1 || true)
drill "huge page stays within the node budget" "budget respected" "$OUT"
drill "huge page extracts in reasonable time" "within time budget" "$OUT"

echo
echo "$PASS passed, $FAIL failed$([ "$SKIP" -gt 0 ] && echo ", $SKIP skipped")"
[ "$FAIL" -eq 0 ] || exit 1
