#!/bin/bash
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/dayframe-shared-storage.XXXXXX")"
trap 'rm -rf "$test_directory"' EXIT
xcrun swiftc \
  "$repository_root/apps/mobile/ios/Dayframe/DayframeSharedStorageConfiguration.swift" \
  "$repository_root/scripts/fixtures/ios-shared-storage/main.swift" \
  -o "$test_directory/validate-shared-storage"
"$test_directory/validate-shared-storage"
