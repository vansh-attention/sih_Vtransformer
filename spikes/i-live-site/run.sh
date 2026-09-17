#!/bin/bash
# Spike I: does this work on a LIVE website, right now, on the open internet?
#
# Needs network access, so it is the one check here that can fail for reasons that have
# nothing to do with our code. It says so rather than reporting a false red.
set -u

# Locate browsers portably; hardcoded paths broke this for everyone but
# one machine.
. "$(cd "$(dirname "$0")" && pwd)/../../scripts/find-browser.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
PORT=8979
CHROME="$(find_chrome)" || { echo "no Chrome found — run scripts/get-chrome-for-testing.sh"; exit 1; }
OUT="$ROOT/spikes/i-live-site/result.json"
rm -f "$OUT"
pkill -f "spikec_serve" 2>/dev/null; pkill -f spikeI-profile 2>/dev/null; sleep 1
# Fresh profile every run. Chrome caches the extension's service worker in the profile,
# so a reused one silently runs YESTERDAY'S code against today's build - which cost a
# confusing round of "the fix did not work" when the fix was never loaded.
rm -rf /tmp/spikeI-profile

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
    def do_GET(self):
        # The harness tells the extension which page to open. Empty means "use the
        # local capture", which is what makes this runnable without a network.
        if self.path == '/target':
            body = os.environ.get('SIH_LIVE_URL', '').encode()
            self.send_response(200); self.send_header('content-type','text/plain')
            self.send_header('content-length', str(len(body)))
            self.send_header('Access-Control-Allow-Origin','*'); self.end_headers()
            self.wfile.write(body); return
        return super().do_GET()

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
  --user-data-dir=/tmp/spikeI-profile \
  --load-extension="$ROOT/extension" \
  --window-size=1200,800 --window-position=0,0 \
  --no-first-run --no-default-browser-check \
  "about:blank" >/tmp/chrome-i.log 2>&1 & CHR=$!

for i in $(seq 1 60); do [ -f "$OUT" ] && break; sleep 1; done
kill $CHR 2>/dev/null; kill $SRV 2>/dev/null; wait 2>/dev/null
if [ ! -f "$OUT" ]; then
  echo "SKIP: no result. This check loads a LIVE page, so it needs network access and"
  echo "      a site that responds. Set SIH_LIVE_URL to something reachable, or run"
  echo "      the rest of the suite, which needs no network at all."
  exit 0
fi

# Assert the PIXELS, not the file's existence. Spike E taught this the hard way.
python3 - "$OUT" <<'EOF'
import json, sys
i = json.load(open(sys.argv[1])).get("spikeI", {})
if i.get("error") or not i.get("url"):
    print(f"SKIP: this page could not be scanned")
    print(f"      {i.get('error') or 'the extension reported no result for it'}")
    print( "      Common causes: the site blocks extensions, or it never finished loading.")
    sys.exit(0)
if i.get("nothingToTest"):
    print(f"SKIP: {i.get('url')}")
    print( "      no VISIBLE form field to type into, so there was nothing to redact.")
    print( "      Hidden boxes were pruned, which is correct but proves nothing.")
    print( "      Point SIH_LIVE_URL at a page with a form you can actually see.")
    sys.exit(0)
if not i.get("verified"):
    print("FAILED: live scan did not protect every planted value")
    print(f"  url        : {i.get('url')}")
    print(f"  typed      : {i.get('typed')}")
    print(f"  loaded ok  : {i.get('loadedCleanly')}")
    det = {d["value"]: d for d in (i.get("typed") or {}).get("detail", [])}
    for s_ in i.get("perValue", []):
        d = det.get(s_["value"], {})
        vis = "" if not d else f"   [input {d['name']} {d['w']}x{d['h']} visible={d['visible']}]"
        print(f"    {s_['outcome']:14} {s_['value']}{vis}")
    if i.get("leaked"):
        print("  A LEAK. This is the serious case.")
    else:
        print("  No leak. The unprotected values were never extracted, usually because")
        print("  the inputs are hidden, so there is nothing to redact and nothing sent.")
    sys.exit(1)
print(f"OK: scan of {i['url']}")
print(f"    {i['nodeCount']} elements read, {i['bytes']} bytes would be sent")
for s_ in i.get("perValue", []):
    print(f"      {s_['outcome']:14} {s_['value']}")
if i.get("notExtractedCount"):
    print(f"    NOTE {i['notExtractedCount']} planted value(s) were never extracted, so they")
    print( "         were neither leaked nor protected. Not a pass for those fields.")
EOF
