#!/bin/bash
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/dayframe-location-signals.XXXXXX")"
trap 'rm -rf "$test_directory"' EXIT
xcrun swiftc \
  "$repository_root/apps/mobile/modules/dayframe-location-visits/ios/DayframeLocationSignalStore.swift" \
  "$repository_root/scripts/fixtures/ios-location-signal-store/main.swift" \
  -o "$test_directory/validate-location-signals"
"$test_directory/validate-location-signals"
