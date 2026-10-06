#!/usr/bin/env bash
# Standard pre-PR checks. Usage: tools/prcheck.sh [--build]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

run() {
  printf '\n== %s\n' "$*"
  "$@"
}

run npm run typecheck
run npm run lint
run npm run test
run npm run check:docs
run git diff --check
if [[ "${1:-}" == "--build" ]]; then
  run npm run build
fi
printf '\nAll checks passed at %s\n' "$(git rev-parse --short HEAD)"
