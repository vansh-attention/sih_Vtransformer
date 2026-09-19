#!/usr/bin/env bash
#
# Gate on UNDEFINED IDENTIFIERS.
#
# esbuild strips TypeScript types without checking them, so nothing in this project
# ever compiled the code. That is how `orchestrator.ts` shipped a call to
# `ensureOffscreen()` it never imported: every turn needing a screenshot threw
# "ensureOffscreen is not defined", the panel reported "Screenshot withheld", and the
# agent — now blind — looped on "wait, form loading" until it hit the turn limit. On a
# live page, in front of him.
#
# WIDENED 19 Sep to a SET of codes, all of which are "wrong at runtime" rather than
# "untidy". The new one earned its place the same day the gate proved too narrow:
#
#   TS1117  duplicate property in an object literal
#
# The panel sent `{ target: 'content', type: 'fill-user-value', target, value }`. The
# shorthand silently overwrote the routing field with an element id, the content script's
# `msg.target !== 'content'` guard dropped the message, and the button that hands the
# agent a value it asked for could never have worked. tsc knew. Nothing asked tsc.
#
# The rule for adding a code here: it must describe something that MISBEHAVES at runtime,
# and it must currently have zero instances in the backlog — a gate that starts red is a
# gate somebody disables. Checked before adding: the backlog is TS2339, TS2322, TS2591,
# TS2345, TS2488, TS2367 and TS2362, none of which are gated.
#
# This gates on that set, and deliberately no wider. The codebase has
# other type errors that are real but not defects — `unknown` not narrowed, a missing
# @types/node for one Node-only branch — and failing the suite on those today would
# mean either a large risky refactor or a disabled check. A narrow gate that always
# runs beats a broad one that gets switched off.
#
# ⚠ The remaining errors are NOT fixed. `--all` prints them; treat it as a backlog.
set -uo pipefail
cd "$(dirname "$0")/.."

OUT=$(npx tsc --noEmit 2>&1 || true)

if [ "${1:-}" = "--all" ]; then
  echo "$OUT"
  echo "---"
  echo "$(printf '%s\n' "$OUT" | grep -c 'error TS') type error(s) total (backlog, not gated)"
  exit 0
fi

GATED='TS2304|TS2552|TS1117|TS2448|TS2454'
BROKEN=$(printf '%s\n' "$OUT" | grep -E "error (${GATED})" || true)
if [ -n "$BROKEN" ]; then
  echo "$BROKEN"
  echo
  echo "✘ these are not style — they misbehave at runtime:"
  echo "   TS2304/TS2552  undefined identifier      -> ReferenceError"
  echo "   TS1117         duplicate property        -> silently overwritten"
  echo "   TS2448/TS2454  used before assigned      -> undefined at the wrong moment"
  exit 1
fi

TOTAL=$(printf '%s\n' "$OUT" | grep -c 'error TS' || true)
echo "no runtime-breaking type errors (${TOTAL} other type error(s) known, see --all)"
