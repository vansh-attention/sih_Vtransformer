#!/bin/bash
# Spike G: what do the numbers look like on a machine that ISN'T an M5?
#
# Every performance figure in this project was measured on Apple M5 with a metal-3 GPU.
# A judge's laptop will be slower and we do not know by how much - which makes every
# number unsafe to put on a slide.
#
# Chrome's DevTools protocol can throttle the CPU by a fixed multiplier
# (Emulation.setCPUThrottlingRate). 4x and 6x approximate a mid-range and a low-end
# laptop respectively. It does NOT throttle the GPU, so the vision numbers here remain
# optimistic - stated rather than hidden.
set -u

# Locate browsers portably; hardcoded paths broke this for everyone but
# one machine.
. "$(cd "$(dirname "$0")" && pwd)/../../scripts/find-browser.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
PORT=8981
CHROME="$(find_chrome)" || { echo "no Chrome found — run scripts/get-chrome-for-testing.sh"; exit 1; }
OUT="$ROOT/spikes/g-slow-machine/result.json"
rm -f "$OUT"
pkill -f "slowspike_serve" 2>/dev/null; sleep 1

python3 - "$PORT" "$OUT" "$ROOT/spikes/g-slow-machine" <<'PY' & SRV=$!
# slowspike_serve
import http.server, socketserver, sys, threading
PORT, OUT, ROOT = int(sys.argv[1]), sys.argv[2], sys.argv[3]
done = threading.Event()
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy','same-origin')
        self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        super().end_headers()
    def do_POST(self):
        open(OUT,'wb').write(self.rfile.read(int(self.headers.get('content-length',0))))
        self.send_response(204); self.end_headers(); done.set()
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1',PORT),H) as s:
    threading.Thread(target=s.serve_forever,daemon=True).start()
    print('collector up',flush=True); done.wait(timeout=300)
PY
sleep 1

# Vendor the runtime and models the page needs.
mkdir -p spikes/g-slow-machine/ort spikes/g-slow-machine/models
cp extension/ort/*.wasm extension/ort/*.mjs spikes/g-slow-machine/ort/ 2>/dev/null
cp extension/models/ultraface_rfb320.onnx extension/models/mobilevit_fp32.onnx \
   spikes/g-slow-machine/models/ 2>/dev/null

"$CHROME" --headless=new --no-sandbox --enable-unsafe-webgpu --use-angle=metal \
  --user-data-dir=/tmp/spikeG-profile --remote-debugging-port=9333 \
  "http://127.0.0.1:$PORT/index.html" >/tmp/chrome-g.log 2>&1 & CHR=$!

sleep 3
node "$ROOT/spikes/g-slow-machine/throttle.mjs" 2>&1 | sed 's/^/  /'

for i in $(seq 1 180); do [ -f "$OUT" ] && break; sleep 1; done
kill $CHR 2>/dev/null; kill $SRV 2>/dev/null; wait 2>/dev/null
rm -rf spikes/g-slow-machine/ort spikes/g-slow-machine/models
[ -f "$OUT" ] && echo "OK: $OUT" || echo "NO RESULT (see /tmp/chrome-g.log)"
