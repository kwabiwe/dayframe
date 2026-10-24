#!/bin/bash
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd)"
test_directory="$(mktemp -d "${TMPDIR:-/tmp}/dayframe-diagnostics.XXXXXX")"
trap 'rm -rf "$test_directory"' EXIT
# The C capture routine is compiled as the app compiles it, and imported as the bridging header does.
xcrun clang -c -O0 -Wall -Werror "$repository_root/apps/mobile/ios/Dayframe/DayframeThreadSampler.c" \
  -o "$test_directory/DayframeThreadSampler.o"
xcrun swiftc \
  -import-objc-header "$repository_root/apps/mobile/ios/Dayframe/DayframeThreadSampler.h" \
  "$test_directory/DayframeThreadSampler.o" \
  "$repository_root/apps/mobile/ios/Dayframe/DayframeDiagnosticsCore.swift" \
  "$repository_root/scripts/fixtures/ios-diagnostics/main.swift" \
  -o "$test_directory/validate-diagnostics"
"$test_directory/validate-diagnostics"
