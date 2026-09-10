#!/bin/bash
# Spike B: does the client stack work in Firefox, and what does the fallback cost?
#
# The PS names Chrome AND Firefox. Firefox's WebGPU trails Chrome's, so this measures
# whether Firefox lands on WebGPU or falls back to WASM — and how much that costs.
# Reuses the Spike A1 harness unchanged so the numbers are directly comparable.
set -u

# Locate browsers portably; hardcoded paths broke this for everyone but
# one machine.
. "$(cd "$(dirname "$0")" && pwd)/../../scripts/find-browser.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT/spikes/a-webgpu-vit"
PORT=${PORT:-8973}
FF="$(find_firefox)" || { echo "no Firefox found — install it or set FIREFOX=/path/to/firefox"; exit 1; }
OUT="$ROOT/spikes/b-firefox/result.json"
PROFILE=$(mktemp -d /tmp/ff-spike-XXXX)

# Firefox ships WebGPU behind prefs on some platforms; turn it on explicitly so we are
# measuring capability, not a default we could have changed.
cat > "$PROFILE/user.js" <<'PREFS'
user_pref("dom.webgpu.enabled", true);
user_pref("gfx.webgpu.force-enabled", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
PREFS

export RESULT_FILE="$OUT"
rm -f "$OUT"
pkill -f "serve.py $PORT" 2>/dev/null; sleep 1
python3 serve.py "$PORT" & SRV=$!
sleep 1

"$FF" --headless --profile "$PROFILE" --new-instance \
  "http://127.0.0.1:$PORT/index.html" >/tmp/firefox-b.log 2>&1 & FFPID=$!

for i in $(seq 1 150); do [ -f "$OUT" ] && break; sleep 1; done
kill $FFPID 2>/dev/null; kill $SRV 2>/dev/null; wait 2>/dev/null
if [ -f "$OUT" ]; then echo "OK: $OUT"; else echo "FAILED: no result after 150s"; fi
rm -rf "$PROFILE"
