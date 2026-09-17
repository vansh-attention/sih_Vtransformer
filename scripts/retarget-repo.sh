#!/usr/bin/env bash
#
# Point everything at the team organisation, once the name is decided.
#
# The repository currently lives under a personal account. Moving it to an org that
# represents all six members touches four places, and doing them in the wrong order
# leaves the report advertising a URL that 404s. This does them in the right order and
# verifies each one, so the switch is a single command on the day.
#
#   ./scripts/retarget-repo.sh <org> [repo-name]
#
# Example:
#   ./scripts/retarget-repo.sh antardrishti browser-agent
#
# WHAT THIS DOES NOT DO
# It does not create the organisation and it does not transfer the repository. Neither
# is possible from here: creating an org needs the GitHub web UI, and transferring needs
# the CURRENT OWNER's admin rights, which Harsh does not hold on a repo owned by Vansh.
# Both are listed in outreach/ORG-MIGRATION.md as steps for a person.
set -euo pipefail

ORG="${1:-}"
NEW_NAME="${2:-sih_Vtransformer}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "$ORG" ]; then
  echo "usage: ./scripts/retarget-repo.sh <org> [repo-name]" >&2
  exit 1
fi

NEW_PATH="$ORG/$NEW_NAME"
NEW_URL="https://github.com/$NEW_PATH"

# Where we are coming FROM, read off the remote before it is changed. Every retarget has
# left the same trail to clean by hand: the clone URL and the "cd <repo>" line under it in
# README, ONBOARDING, RUNBOOK and the team documents. Three of these in one afternoon is
# enough to stop doing it by hand.
OLD_URL="$(git remote get-url origin 2>/dev/null || echo "")"
OLD_PATH="$(printf '%s' "$OLD_URL" | sed -E 's#^.*github\.com[:/]##; s#\.git$##')"
OLD_NAME="${OLD_PATH##*/}"

echo "retargeting everything to $NEW_PATH"
[ -n "$OLD_PATH" ] && echo "  (from $OLD_PATH)"
echo

# 1. The repository must actually exist before anything advertises it. Checking first
#    turns "the report prints a dead link" into a message on this terminal instead.
#    An unauthenticated curl was the original check, and it reports 404 for a PRIVATE
#    repository that exists perfectly well. The org repo is private, so ask GitHub as
#    ourselves and fall back to curl only when gh is not installed.
if command -v gh >/dev/null 2>&1; then
  vis=$(gh api "repos/$NEW_PATH" --jq '.private' 2>/dev/null || echo "missing")
  case "$vis" in
    true)  echo "  ok   $NEW_URL exists (PRIVATE — a clone by anyone outside the org will fail)" ;;
    false) echo "  ok   $NEW_URL exists and is public" ;;
    *)     echo "  STOP: $NEW_PATH is not reachable as $(gh api user --jq .login 2>/dev/null)."
           echo "        Create the org and the repo first; see outreach/ORG-MIGRATION.md."
           exit 1 ;;
  esac
else
  code=$(curl -s -o /dev/null -w "%{http_code}" "$NEW_URL")
  if [ "$code" != "200" ]; then
    echo "  STOP: $NEW_URL is not reachable (HTTP $code)."
    echo "        Install gh if the repository is private; see outreach/ORG-MIGRATION.md."
    exit 1
  fi
  echo "  ok   $NEW_URL is live"
fi

# 2. The git remote. A transfer leaves a redirect, so pushes keep working either way,
#    but an explicit remote stops the old name reappearing in everyone's output.
git remote set-url origin "$NEW_URL.git"
echo "  ok   git remote -> $(git remote get-url origin)"

# 3. The report. One assignment, because the URL was deliberately parameterised.
python3 - "$ORG" "$NEW_NAME" <<'PY'
import re, sys, pathlib
org, name = sys.argv[1], sys.argv[2]
p = pathlib.Path("outreach/build-project-report.py")
s = p.read_text(encoding="utf-8")
s = re.sub(r'^REPO_ORG = ".*"$',  f'REPO_ORG = "{org}"',  s, count=1, flags=re.M)
s = re.sub(r'^REPO_NAME = ".*"$', f'REPO_NAME = "{name}"', s, count=1, flags=re.M)
p.write_text(s, encoding="utf-8")
print(f"  ok   report builder -> {org}/{name}")
PY

python3 outreach/build-project-report.py >/dev/null
echo "  ok   report rebuilt"

# 4. Prove it, rather than assume it. The appendix is the one page a reader acts on, so
#    a wrong URL there is worse than no URL at all.
python3 - "$NEW_PATH" <<'PY'
import sys
from pypdf import PdfReader
want = sys.argv[1]
text = "\n".join((pg.extract_text() or "") for pg in
                 PdfReader("outreach/SIH26171-Project-Report.pdf").pages)
if want not in text:
    print(f"  FAIL the report does not contain {want}"); sys.exit(1)
if "vansh-attention" in text:
    print("  FAIL the old path is still printed somewhere"); sys.exit(1)
print(f"  ok   report prints {want} and nothing stale")
PY

# 5. The prose. Leaving this by hand is how a stale clone URL survives a rename: the
#    report is regenerated and looks right, while README and the team documents still
#    send a reader to the old address.
if [ -n "$OLD_PATH" ] && [ "$OLD_PATH" != "$NEW_PATH" ]; then
  python3 scripts/_sweep-paths.py "$OLD_PATH" "$NEW_PATH" "$OLD_NAME" "$NEW_NAME"
  for md in outreach/*.md; do
    [ -f "$md" ] && python3 outreach/build-doc-pdf.py "$md" >/dev/null
  done
  echo "  ok   team PDFs rebuilt"
fi

echo
echo "done. Remaining by hand:"
echo "  - README.md and ONBOARDING.md if they name the old path"
echo "  - the SIH portal Team Name field, and deck slide 1"
grep -rl "vansh-attention" --include="*.md" . 2>/dev/null | sed 's/^/      still mentions it: /' || true
