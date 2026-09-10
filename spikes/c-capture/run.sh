#!/bin/bash
# Spike C: prove the DOM coordinate space maps correctly onto the captured screenshot,
# by sampling actual pixels. Headed Chrome required - captureVisibleTab needs a real
# window with a compositor; headless returns a blank or fails.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
PORT=8974
CHROME=${CHROME:-"/tmp/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"}
OUT="$ROOT/spikes/c-capture/result.json"
rm -f "$OUT"
pkill -f "spikec_serve" 2>/dev/null; pkill -f spikeC-profile 2>/dev/null; sleep 1
# Fresh profile every run. Chrome caches the extension's service worker in the profile,
# so a reused one silently runs YESTERDAY'S code against today's build - which cost a
# confusing round of "the fix did not work" when the fix was never loaded.
rm -rf /tmp/spikeC-profile

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
  --user-data-dir=/tmp/spikeC-profile \
  --load-extension="$ROOT/extension" \
  --window-size=1200,800 --window-position=0,0 \
  --no-first-run --no-default-browser-check \
  "about:blank" >/tmp/chrome-c.log 2>&1 & CHR=$!

for i in $(seq 1 60); do [ -f "$OUT" ] && break; sleep 1; done
kill $CHR 2>/dev/null; kill $SRV 2>/dev/null; wait 2>/dev/null
[ -f "$OUT" ] && echo "OK: $OUT" || echo "FAILED: no result after 60s"
