#!/bin/bash
# One-command spike runner: serve, drive headless Chrome, collect result, clean up.
set -u

# Locate browsers portably; hardcoded paths broke this for everyone but
# one machine.
. "$(cd "$(dirname "$0")" && pwd)/../../scripts/find-browser.sh"
DIR="$(cd "$(dirname "$0")" && pwd)"; cd "$DIR"
PORT=${PORT:-8971}
CHROME="$(find_chrome)" || { echo "no Chrome found — run scripts/get-chrome-for-testing.sh"; exit 1; }
export RESULT_FILE=result-a1.json
rm -f "$RESULT_FILE"
# Kill anything left over from a previous aborted run.
pkill -f "serve.py $PORT" 2>/dev/null; pkill -f spikeA-profile 2>/dev/null; sleep 1
python3 serve.py "$PORT" & SRV=$!
sleep 1
"$CHROME" --headless=new --no-sandbox --enable-unsafe-webgpu --use-angle=metal \
  --user-data-dir=/tmp/spikeA-profile --disable-dev-shm-usage \
  "http://127.0.0.1:$PORT/index.html" >/tmp/chrome-a.log 2>&1 & CHR=$!
for i in $(seq 1 120); do [ -f "$RESULT_FILE" ] && break; sleep 1; done
kill $CHR 2>/dev/null; kill $SRV 2>/dev/null; wait 2>/dev/null
[ -f "$RESULT_FILE" ] && echo "OK: $RESULT_FILE" || echo "FAILED: no result after 120s"
