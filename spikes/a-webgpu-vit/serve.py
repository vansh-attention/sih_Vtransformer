"""Serves the spike with cross-origin isolation headers (needed for wasm threads),
collects the POSTed result, and exits. Keeps the spike a one-command operation."""
import http.server, socketserver, json, sys, threading, os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8971
# Result filename is caller-supplied: Spike B reuses this harness, and a shared
# hardcoded 'result.json' meant one spike silently overwrote the other's output.
OUT = os.environ.get('RESULT_FILE', 'result.json')
done = threading.Event()

class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # SharedArrayBuffer / wasm threads require these.
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def do_POST(self):
        n = int(self.headers.get('content-length', 0))
        body = self.rfile.read(n)
        open(OUT, 'wb').write(body)
        self.send_response(204); self.end_headers()
        done.set()

    def log_message(self, *a): pass

socketserver.TCPServer.allow_reuse_address = True

with socketserver.TCPServer(('127.0.0.1', PORT), H) as httpd:
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(f'serving on {PORT}', flush=True)
    if not done.wait(timeout=300):
        print('TIMEOUT: no result posted', flush=True); sys.exit(1)
    print('result received', flush=True)
