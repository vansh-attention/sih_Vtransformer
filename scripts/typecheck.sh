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
# This gates on TS2304 (Cannot find name) only, and deliberately so. The codebase has
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

UNDEFINED=$(printf '%s\n' "$OUT" | grep 'error TS2304' || true)
if [ -n "$UNDEFINED" ]; then
  echo "$UNDEFINED"
  echo
  echo "✘ undefined identifier(s) — these are ReferenceErrors at runtime, not style"
  exit 1
fi

TOTAL=$(printf '%s\n' "$OUT" | grep -c 'error TS' || true)
echo "no undefined identifiers (${TOTAL} other type error(s) known, see --all)"
