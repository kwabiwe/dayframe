#!/usr/bin/env bash
# Standard pre-PR checks. Usage: tools/prcheck.sh [--build]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

run() {
  printf '\n== %s\n' "$*"
  "$@"
}

# Whitespace errors in the branch's commits and in uncommitted changes.
base="$(git merge-base origin/main HEAD 2>/dev/null || git rev-parse HEAD)"

run npm run typecheck
run npm run lint   # includes check:docs and check:ios-config
run npm run test
run git diff --check "$base"
if [[ "${1:-}" == "--build" ]]; then
  run npm run build
fi
printf '\nAll checks passed at %s\n' "$(git rev-parse --short HEAD)"
