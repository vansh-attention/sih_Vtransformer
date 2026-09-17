#!/usr/bin/env python3
"""Rewrite a repository path across every markdown and text document.

Called by retarget-repo.sh. It is a separate file rather than an inline heredoc because
the script already contains one, and a second here-document sharing the delimiter cuts
the first one short in a way that produces a shell parse error nowhere near the cause.

    python3 scripts/_sweep-paths.py <old-path> <new-path> <old-name> <new-name>

Only the org path is rewritten. A mention of the ORIGINAL personal repository is left
alone deliberately: it is a historical fact, not an address anyone should follow.
"""
import pathlib
import re
import sys

SKIP = {"node_modules", ".git", "dist-firefox"}


def main():
    if len(sys.argv) != 5:
        sys.exit("usage: _sweep-paths.py <old-path> <new-path> <old-name> <new-name>")
    old_path, new_path, old_name, new_name = sys.argv[1:5]

    touched = []
    for p in pathlib.Path(".").rglob("*"):
        if p.suffix not in (".md", ".txt") or not p.is_file():
            continue
        if any(part in SKIP for part in p.parts):
            continue
        original = p.read_text(encoding="utf-8")
        s = original.replace(old_path, new_path)
        if old_name != new_name:
            # The line under a clone command. Without this it still says "cd" the old
            # name and the reader lands in a directory that does not exist.
            s = re.sub(rf"\bcd {re.escape(old_name)}\b", f"cd {new_name}", s)
        if s != original:
            p.write_text(s, encoding="utf-8")
            touched.append(str(p))

    if touched:
        print(f"  ok   rewrote {len(touched)} document(s): " + ", ".join(sorted(touched)))
    else:
        print("  ok   no document mentioned the old path")


if __name__ == "__main__":
    main()
