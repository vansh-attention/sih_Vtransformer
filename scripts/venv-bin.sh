#!/bin/bash
# Where a Python virtualenv puts its executables.
#
# POSIX uses .venv/bin, Windows uses .venv/Scripts. Hardcoding bin/ meant that on
# Windows setup.sh reported "server dependencies installed" without pip ever running,
# and test-all.sh silently skipped every failure drill with a misleading reason.
venv_bin() {
  local root="${1:-server/.venv}"
  if [ -d "$root/Scripts" ]; then echo "$root/Scripts"
  elif [ -d "$root/bin" ]; then echo "$root/bin"
  else return 1
  fi
}

venv_exe() {   # $1 = tool name, $2 = venv root
  local dir; dir="$(venv_bin "${2:-server/.venv}")" || return 1
  if [ -x "$dir/$1" ]; then echo "$dir/$1"
  elif [ -x "$dir/$1.exe" ]; then echo "$dir/$1.exe"
  else return 1
  fi
}
