#!/bin/bash
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/dayframe-diagnostics.XXXXXX")"
trap 'rm -rf "$test_directory"' EXIT
xcrun swiftc \
  "$repository_root/apps/mobile/ios/Dayframe/DayframeDiagnosticsCore.swift" \
  "$repository_root/scripts/fixtures/ios-diagnostics/main.swift" \
  -o "$test_directory/validate-diagnostics"
"$test_directory/validate-diagnostics"
