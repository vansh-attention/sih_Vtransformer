#!/usr/bin/env bash
#
# Package the extension into a zip somebody can load without a toolchain.
#
# `extension/dist/` is gitignored, so a fresh clone contains no loadable extension: you
# need Node 22 and a build step before Chrome will accept it. That is a fair ask of a
# teammate and the wrong thing to hand a professor who has ten minutes.
#
# This produces one zip. Unzip it, open chrome://extensions, enable Developer mode,
# press Load unpacked, choose the folder. No Node, no Python, no model, no terminal.
#
#   ./scripts/package-extension.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/demo/privacy-agent-extension.zip"
STAGE="$(mktemp -d)/privacy-agent-extension"

echo "building first, so the zip cannot contain a stale bundle"
node build.mjs >/dev/null

mkdir -p "$STAGE"
# Only what the browser actually loads. The source tree, tests and fixtures stay out:
# they are on GitHub for anyone who wants them and they triple the download.
cp -R extension/dist "$STAGE/dist"
cp -R extension/icons "$STAGE/icons"
# SCAN-ONLY BUILD BY DEFAULT.
#
# The full extension carries 28 MB of ONNX vision models and 97 MB of onnxruntime. None
# of it is touched by the scan, which is pure DOM work, and the whole point of this zip
# is the scan. Shipping it all produced a 45 MB file that will not go through Gmail's
# 25 MB attachment limit, so the person we most want to try this would have needed a
# Drive link and a second explanation.
#
# Only the name gazetteer is required: it is what catches a person's name, which has no
# pattern and no checksum. Pass --full to include the vision models for a machine that
# will also run the agent.
mkdir -p "$STAGE/models"
cp extension/models/name-gazetteer.json "$STAGE/models/"
if [ "${1:-}" = "--full" ]; then
  cp -R extension/models/. "$STAGE/models/"
  cp -R extension/ort "$STAGE/ort" 2>/dev/null || true
  echo "  including vision models and runtime (--full)"
else
  echo "  scan-only build; pass --full to include the vision models"
fi
mkdir -p "$STAGE/src/panel" "$STAGE/src/offscreen"
cp extension/src/panel/index.html "$STAGE/src/panel/"
cp extension/src/offscreen/index.html "$STAGE/src/offscreen/" 2>/dev/null || true

# THE PANEL'S TYPEFACES.
#
# They are vendored rather than linked: a tool whose headline is that nothing leaves
# your machine must not fetch fonts.googleapis.com on first paint. That means they have
# to be IN the zip — omit them and the panel silently falls back to the system stack,
# nothing errors, and the whole design reads as half-applied on somebody else's laptop.
# The guard at the bottom of this script refuses to ship if any of them is missing.
cp -R extension/fonts "$STAGE/fonts"

cp extension/manifest.json "$STAGE/manifest.json"

# DECLARE WHAT THIS PACKAGE IS.
#
# It has no server/ directory, so the reasoning server cannot be started from it at all
# and "Run on this tab" can never work here. The panel reads this file and stops printing
# a shell command that refers to a directory the reader does not have — it says what IS
# true instead: Scan needs nothing, and the agent needs the repository.
#
# Deliberately overwrites the repo stamp written by build.mjs, which carries an absolute
# path from THIS machine and would be meaningless on anybody else's.
cat > "$STAGE/build-info.json" <<'JSON'
{
  "variant": "scan-only",
  "note": "This package ships the scanner only. It contains no reasoning server, so the agent cannot run from it. Scan needs no server and is the whole privacy demonstration."
}
JSON

# SHIP why.html INSIDE THE ZIP.
#
# READ-ME-FIRST offers it as the option for somebody who would rather not install an
# unsigned extension, and the panel points at it after a successful scan. Both of those
# were referring to a file that was not in the folder, which is a worse first impression
# than not offering it at all. Regenerate it here so the zip cannot carry a stale copy.
node demo/build-story.mjs >/dev/null
cp demo/why.html "$STAGE/why.html"

cat > "$STAGE/READ-ME-FIRST.txt" <<'TXT'
Aavaran - SIH26171
On-Device Visual Perception for Light-Weight Browser Agents


BEFORE YOU INSTALL: WHAT THIS ASKS FOR, AND WHY

  This is an unsigned extension loaded in developer mode, and it requests permission
  to read every site you visit. You should be wary of that. Anyone should. So here
  is exactly what it asks for and why, and you are welcome to check the source.

    <all_urls>   The whole point is to work on ANY page, including one you choose
                 that we have never seen. It cannot demonstrate that with a
                 narrower permission.
    scripting    To read the page's structure. This is how it finds the fields.
    tabs         To know which tab you are looking at.
    sidePanel    To show the results panel.
    storage      To remember the server address you type in settings. Nothing else.

  WHAT IT DOES NOT DO

    It makes no network request during a scan. None. The scan deliberately stops at
    the point just before a request would be made, which is the whole demonstration.
    You can watch this yourself: open DevTools, Network tab, and press Scan. Nothing
    appears.

    It never stores the values it finds. The panel shows a masked shadow, for example
    AB.......F, because a record of every secret on your screen would be worse than
    the problem this solves.

    There is no account, no API key, and no telemetry of any kind.

  If you would rather not install anything, open why.html in THIS folder instead. It
  is an ordinary web page, it needs nothing at all, and it makes the same argument:
  one screen, sent the way an ordinary assistant sends it, and sent the way this
  project sends it. Or ask the team to show you on their laptop.


TO INSTALL (about a minute)

  Needs Google Chrome. A Firefox build exists in the repository; this zip is Chrome.

  1. Open Chrome and go to:  chrome://extensions
  2. Turn on "Developer mode" (top right)
  3. Press "Load unpacked"
  4. Choose THIS folder (the one containing manifest.json)


TO USE IT

  5. Open any website with a form YOU CAN SEE. A login page works well.
  6. Type something into a field: a name, a phone number, a PAN.

     Please use a made-up value, not your own. ABCPE1234F is a correctly formed PAN
     that belongs to nobody.

  7. Click the extension's icon in the toolbar. A panel opens on the right.
  8. Press "Scan this page". It needs no model and no server.


WHAT YOU WILL SEE

  Every personal value it found, what it would have sent instead, and how many bytes
  would have left your machine.

  If it finds nothing, check you typed into a field you can actually SEE. Hidden
  boxes are ignored on purpose, and a page whose only input is a collapsed search bar
  will honestly report that there was nothing to redact.

  Then, to see what it is FOR rather than just what it does, open why.html in this
  folder. It is generated by running this same code, so it is a result and not a
  drawing.


WHAT THIS ZIP LEAVES OUT

  The agent that also ACTS on the page needs a 6 GB language model running locally.
  That is not here and is not needed to check the privacy claim, which is the part
  worth checking. The full thing is in the repository.

TXT

# zip ADDS to an existing archive rather than replacing it. Without this the previous
# build's files survive: a scan-only build kept 97 MB of onnxruntime from the full one
# before it, and reported the old size as if nothing had changed.
rm -f "$OUT"
( cd "$(dirname "$STAGE")" && zip -qr "$OUT" "$(basename "$STAGE")" )
rm -rf "$(dirname "$STAGE")"

# The readme sends the reader to files by name. Shipping a zip that names a file it does
# not contain is worse than saying nothing, and it happened once: why.html was offered as
# the no-install option and was not in the folder. Refuse to ship that again.
python3 - "$OUT" <<'PY'
import re, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
have = {n.split('/', 1)[1] for n in z.namelist() if '/' in n}
readme = z.read('privacy-agent-extension/READ-ME-FIRST.txt').decode()
missing = sorted(f for f in set(re.findall(r'\b[\w.-]+\.(?:html|json|txt)\b', readme))
                 if f not in have)
if missing:
    sys.exit('  REFUSING to ship: READ-ME-FIRST names files not in the zip: '
             + ', '.join(missing))
print('  readme references check out: ' + ', '.join(sorted(
    f for f in set(re.findall(r'\b[\w.-]+\.(?:html|json|txt)\b', readme)))))

# THE PANEL'S OWN ASSETS.
#
# Same failure shape as the readme naming a file it does not ship, but worse, because
# a missing woff2 does not error anywhere: the panel just renders on the fallback
# stack and looks subtly wrong on the one machine we are not watching. Resolve every
# url() in the panel's stylesheet against its own location and demand it be present.
import posixpath
panel = 'privacy-agent-extension/src/panel/index.html'
css = z.read(panel).decode()
refs = re.findall(r"url\(['\"]([^'\"]+)['\"]\)", css)
missing_assets = sorted(
    r for r in set(refs)
    if not r.startswith(('data:', 'http:', 'https:'))
    and posixpath.normpath(posixpath.join(posixpath.dirname(panel), r)) not in z.namelist())
if missing_assets:
    sys.exit('  REFUSING to ship: the panel references assets not in the zip: '
             + ', '.join(missing_assets))
print(f'  panel assets check out: {len(set(refs))} url() reference(s) all present')

# THE BUILD STAMP MUST BE THE SCAN-ONLY ONE.
#
# build.mjs writes a repo stamp carrying this machine's ABSOLUTE paths — including the
# home directory name. Shipping that would both tell the reader to start a server this
# package does not contain, and print a stranger's home path on her screen.
import json as _json
info = _json.loads(z.read('privacy-agent-extension/build-info.json'))
if info.get('variant') != 'scan-only':
    sys.exit(f"  REFUSING to ship: build-info.json says variant={info.get('variant')!r}, "
             "expected 'scan-only' — the repo stamp has leaked into the package")
leaked = [n for n in z.namelist()
          if n.endswith(('.json', '.txt', '.html'))
          and b'/Users/' in z.read(n)]
if leaked:
    sys.exit('  REFUSING to ship: a local absolute path appears in: ' + ', '.join(leaked))
print('  build stamp: scan-only, no local paths')
# Gmail rejects attachments over 25 MB, which is how the 45 MB build was found.
mb = sum(i.file_size for i in z.infolist()) / 1e6
print(f'  unpacked size: {mb:.1f} MB')
PY

echo "wrote $OUT"
ls -lh "$OUT" | awk '{print "  size: " $5}'
echo "  contents:"
unzip -l "$OUT" | awk 'NR>3 && NF>3 {print "    " $4}' | head -12
