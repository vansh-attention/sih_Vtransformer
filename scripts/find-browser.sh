#!/bin/bash
# Locate a browser, on whatever machine this is.
#
#   source scripts/find-browser.sh
#   CHROME=$(find_chrome) || echo "no chrome"
#   FIREFOX=$(find_firefox)
#
# The spike runners used to hardcode macOS paths — one of them pointed at a specific
# person's Desktop — which meant every script silently failed for everyone else on the
# team. Overridable with $CHROME / $FIREFOX so an unusual install still works.
#
# Chrome for Testing is PREFERRED over branded Chrome: branded Chrome refuses
# --load-extension (Google removed it as an abuse mitigation), so extension spikes only
# work in the Testing build. See spikes/a-webgpu-vit/FINDINGS.md.

find_chrome() {
  [ -n "${CHROME:-}" ] && [ -x "$CHROME" ] && { echo "$CHROME"; return 0; }

  local candidates=(
    # Chrome for Testing, installed by scripts/get-chrome-for-testing.sh
    "$HOME/.cache/sih-browsers/chrome/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    "$HOME/.cache/sih-browsers/chrome/chrome"
    "/tmp/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    # macOS
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$HOME/Desktop/Google Chrome.app/Contents/MacOS/Google Chrome"
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
    # Linux
    "/usr/bin/google-chrome" "/usr/bin/google-chrome-stable"
    "/usr/bin/chromium" "/usr/bin/chromium-browser"
    "/snap/bin/chromium"
    # Windows via Git Bash / WSL
    "/c/Program Files/Google/Chrome/Application/chrome.exe"
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
  )
  local c
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  for c in google-chrome google-chrome-stable chromium chromium-browser; do
    command -v "$c" >/dev/null 2>&1 && { command -v "$c"; return 0; }
  done
  return 1
}

find_firefox() {
  [ -n "${FIREFOX:-}" ] && [ -x "$FIREFOX" ] && { echo "$FIREFOX"; return 0; }
  [ -n "${FF:-}" ] && [ -x "$FF" ] && { echo "$FF"; return 0; }

  local candidates=(
    "/Applications/Firefox.app/Contents/MacOS/firefox"
    "$HOME/Applications/Firefox.app/Contents/MacOS/firefox"
    "/Volumes/Firefox/Firefox.app/Contents/MacOS/firefox"
    "/usr/bin/firefox" "/snap/bin/firefox"
    "/c/Program Files/Mozilla Firefox/firefox.exe"
    "/mnt/c/Program Files/Mozilla Firefox/firefox.exe"
  )
  local c
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  command -v firefox >/dev/null 2>&1 && { command -v firefox; return 0; }
  return 1
}

# `pkill -f` is not on Windows/Git Bash, and plain `kill` needs a pid we may not have.
# Every script needs this, so it lives here rather than being reinvented five times.
kill_matching() {
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "$1" 2>/dev/null || true
  elif command -v taskkill >/dev/null 2>&1; then
    taskkill //F //IM "$1" >/dev/null 2>&1 || true
  fi
}
