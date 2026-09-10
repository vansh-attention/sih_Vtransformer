#!/bin/bash
# Download Chrome for Testing into ~/.cache/sih-browsers/chrome
#
# Branded Chrome REFUSES --load-extension (Google removed it as an abuse mitigation), so
# every extension spike needs the Testing build. This fetches the right one for whatever
# machine you are on.
set -eu
CACHE="$HOME/.cache/sih-browsers/chrome"
[ -d "$CACHE" ] && { echo "already at $CACHE"; exit 0; }

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  PLAT=mac-arm64 ;;
  Darwin-x86_64) PLAT=mac-x64 ;;
  Linux-x86_64)  PLAT=linux64 ;;
  MINGW*|MSYS*|CYGWIN*) PLAT=win64 ;;
  *) echo "unsupported platform: $(uname -s)-$(uname -m)"; echo "set CHROME=/path/to/chrome instead"; exit 1 ;;
esac

echo "fetching Chrome for Testing ($PLAT)…"
URL=$(curl -s https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json \
  | python3 -c "import json,sys;d=json.load(sys.stdin)['channels']['Stable']['downloads']['chrome'];print(next(x['url'] for x in d if x['platform']=='$PLAT'))")

mkdir -p "$CACHE"
TMP=$(mktemp -d)
curl -sL -o "$TMP/chrome.zip" "$URL"
unzip -q "$TMP/chrome.zip" -d "$TMP"
mv "$TMP"/chrome-*/* "$CACHE"/
rm -rf "$TMP"
[ "$(uname -s)" = "Darwin" ] && xattr -dr com.apple.quarantine "$CACHE" 2>/dev/null || true
echo "installed to $CACHE"
