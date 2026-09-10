#!/bin/bash
# Spike A2: load the real MV3 extension in Chrome and see whether ORT + WebGPU survive
# the extension CSP inside an offscreen document.
set -u

# Locate browsers portably; hardcoded paths broke this for everyone but
# one machine.
. "$(cd "$(dirname "$0")" && pwd)/../../scripts/find-browser.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
PORT=8972
CHROME="$(find_chrome)" || { echo "no Chrome found — run scripts/get-chrome-for-testing.sh"; exit 1; }
OUT="spikes/a-webgpu-vit/result-a2.json"
rm -f "$OUT"
pkill -f "collect.py $PORT" 2>/dev/null; pkill -f spikeA2-profile 2>/dev/null; sleep 1

python3 - "$PORT" "$OUT" <<'PY' & SRV=$!
import http.server, socketserver, sys, threading
PORT, OUT = int(sys.argv[1]), sys.argv[2]
done = threading.Event()
class H(http.server.BaseHTTPRequestHandler):
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

"$CHROME" --headless=new --no-sandbox --enable-unsafe-webgpu --use-angle=metal \
  --user-data-dir=/tmp/spikeA2-profile \
  --disable-extensions-except="$ROOT/extension" \
  --load-extension="$ROOT/extension" \
  --enable-logging=stderr --v=0 \
  "about:blank" >/tmp/chrome-a2.log 2>&1 & CHR=$!

for i in $(seq 1 90); do [ -f "$OUT" ] && break; sleep 1; done
kill $CHR 2>/dev/null; kill $SRV 2>/dev/null; wait 2>/dev/null
[ -f "$OUT" ] && echo "OK: $OUT" || echo "FAILED: no result after 90s"
