#!/bin/bash
# Spike F: does the extension actually LOAD and RUN in Firefox?
#
# Spike B tested ORT on a plain Firefox page. It never tested the extension, and the
# manifest audit found five hard Firefox blockers - so "Firefox works" was an
# unverified claim until this ran.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
PORT=8977
FF=${FF:-"/Volumes/Firefox/Firefox.app/Contents/MacOS/firefox"}
OUT="$ROOT/spikes/f-firefox-ext/result.json"
PROFILE=$(mktemp -d /tmp/ff-ext-XXXX)
rm -f "$OUT"
pkill -f "ffspike_serve" 2>/dev/null; sleep 1

# Build a Firefox-manifest copy of the extension. Swapping manifest.json in place would
# leave the tree in a Firefox-only state if this script died halfway.
BUILD=$(mktemp -d /tmp/ff-ext-build-XXXX)
cp -R extension/. "$BUILD/"
cp "$BUILD/manifest.firefox.json" "$BUILD/manifest.json"

cat > "$PROFILE/user.js" <<'PREFS'
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.experiments.enabled", true);
user_pref("devtools.debugger.remote-enabled", true);
# Without this Firefox shows a modal asking the user to approve the RDP connection, and
# a headless-ish automated run just hangs on it.
user_pref("devtools.debugger.prompt-connection", false);
user_pref("devtools.debugger.force-local", true);
user_pref("devtools.chrome.enabled", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("dom.webgpu.enabled", true);
PREFS

python3 - "$PORT" "$OUT" "$ROOT/bench" <<'PY' & SRV=$!
# ffspike_serve
import http.server, socketserver, sys, threading
PORT, OUT, ROOT = int(sys.argv[1]), sys.argv[2], sys.argv[3]
done = threading.Event()
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a, directory=ROOT, **k)
    def do_POST(self):
        open(OUT,'wb').write(self.rfile.read(int(self.headers.get('content-length',0))))
        self.send_response(204); self.send_header('Access-Control-Allow-Origin','*'); self.end_headers(); done.set()
    def do_OPTIONS(self):
        self.send_response(204); self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','content-type'); self.end_headers()
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1',PORT),H) as s:
    threading.Thread(target=s.serve_forever,daemon=True).start()
    print('collector up',flush=True); done.wait(timeout=180)
PY
sleep 1

# --start-debugger-server lets us install a temporary add-on over the RDP, which is the
# only scriptable way to sideload an unsigned extension into Firefox.
"$FF" --profile "$PROFILE" --start-debugger-server 6000 --new-instance \
  "http://127.0.0.1:$PORT/pages/checkout.html" >/tmp/firefox-ext.log 2>&1 & FFPID=$!
# Wait for the debugger port rather than guessing at a sleep duration.
for i in $(seq 1 30); do
  if nc -z 127.0.0.1 6000 2>/dev/null; then echo "debugger port open after ${i}s"; break; fi
  sleep 1
done
nc -z 127.0.0.1 6000 2>/dev/null || echo "WARN: debugger port 6000 never opened"
node "$ROOT/spikes/f-firefox-ext/install.mjs" "$BUILD" 2>&1 | tee -a /tmp/firefox-ext.log || true

for i in $(seq 1 90); do [ -f "$OUT" ] && break; sleep 1; done
kill $FFPID 2>/dev/null; kill $SRV 2>/dev/null; wait 2>/dev/null
rm -rf "$PROFILE" "$BUILD"
[ -f "$OUT" ] && echo "OK: $OUT" || echo "NO RESULT (see /tmp/firefox-ext.log)"
