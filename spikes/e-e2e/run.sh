#!/bin/bash
# Spike C: prove the DOM coordinate space maps correctly onto the captured screenshot,
# by sampling actual pixels. Headed Chrome required - captureVisibleTab needs a real
# window with a compositor; headless returns a blank or fails.
set -u

# Locate browsers portably; hardcoded paths broke this for everyone but
# one machine.
. "$(cd "$(dirname "$0")" && pwd)/../../scripts/find-browser.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
PORT=8976
CHROME="$(find_chrome)" || { echo "no Chrome found — run scripts/get-chrome-for-testing.sh"; exit 1; }
OUT="$ROOT/spikes/e-e2e/result.json"
rm -f "$OUT"
pkill -f "spikec_serve" 2>/dev/null; pkill -f spikeC-profile 2>/dev/null; sleep 1
# Fresh profile every run. Chrome caches the extension's service worker in the profile,
# so a reused one silently runs YESTERDAY'S code against today's build - which cost a
# confusing round of "the fix did not work" when the fix was never loaded.
rm -rf /tmp/spikeE-profile

python3 - "$PORT" "$OUT" "$ROOT/bench" <<'PY' & SRV=$!
# spikec_serve
import http.server, socketserver, sys, threading, os
PORT, OUT, ROOT = int(sys.argv[1]), sys.argv[2], sys.argv[3]
done = threading.Event()
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a, directory=ROOT, **k)
    def do_POST(self):
        open(OUT,'wb').write(self.rfile.read(int(self.headers.get('content-length',0))))
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin','*'); self.end_headers(); done.set()
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','content-type'); self.end_headers()
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1',PORT),H) as s:
    threading.Thread(target=s.serve_forever,daemon=True).start()
    print('collector up',flush=True); done.wait(timeout=180)
PY
sleep 1

"$CHROME" --no-sandbox --enable-unsafe-webgpu --use-angle=metal \
  --user-data-dir=/tmp/spikeE-profile \
  --load-extension="$ROOT/extension" \
  --window-size=1200,800 --window-position=0,0 \
  --no-first-run --no-default-browser-check \
  "about:blank" >/tmp/chrome-e.log 2>&1 & CHR=$!

for i in $(seq 1 240); do [ -f "$OUT" ] && break; sleep 1; done
kill $CHR 2>/dev/null; kill $SRV 2>/dev/null; wait 2>/dev/null

# ASSERT THE TASK GOT DONE, not that a file appeared.
#
# This script used to exit 0 the moment result.json existed, so the suite reported
# "Spike E - full agent loop in Chrome" as passing through every run in which the agent
# filled two fields of three and gave up. The loop had run; the task had failed; the
# check could not tell the difference. `outcome.verified` is computed by reading the
# PAGE after the run -- all fields populated and the success banner actually visible --
# so it cannot be satisfied by the loop's own opinion of itself.
if [ ! -f "$OUT" ]; then echo "FAILED: no result after 240s"; exit 1; fi

python3 - "$OUT" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
e = d.get("spikeE", d)
o = e.get("outcome", {})
r = e.get("resources", {})
if not o.get("verified"):
    print("FAILED: the task did not complete")
    print("  fields:", [(f["id"], f["value"]) for f in o.get("fields", [])])
    print("  stopReason:", e.get("stopReason"), "|", e.get("detail"))
    sys.exit(1)

# THE VISION TURN MUST ACTUALLY HAVE RUN.
#
# This spike passed green for a day while `orchestrator.ts` called an unimported
# `ensureOffscreen()`, because multistep.html had nothing needing vision: the queue was
# empty, the screenshot path was never entered, and `visionMs` was 0 on every turn. On a
# real page the same run threw on every turn and the agent went blind. The fixture now
# carries an image, so a green Spike E means the screenshot path was exercised.
recs = e.get("records") or e.get("turns") or []
if isinstance(recs, list) and recs:
    errs = [r_.get("visionError") for r_ in recs if isinstance(r_, dict) and r_.get("visionError")]
    vis  = [r_.get("timings", {}).get("visionMs", 0) for r_ in recs if isinstance(r_, dict)]
    if errs:
        print("FAILED: the vision turn errored:", errs[:2]); sys.exit(1)
    if not any(v and v > 0 for v in vis):
        print("FAILED: no vision turn ran — the screenshot path was never exercised.")
        print("  visionMs per turn:", vis)
        sys.exit(1)
    print(f"OK: vision ran on {sum(1 for v in vis if v and v>0)}/{len(vis)} turn(s), no visionError")

print(f"OK: task verified on the page in {r.get('taskMs')}ms "
      f"over {r.get('turns')} turns, browser heap +{r.get('heapDeltaMb')}MB")
EOF
