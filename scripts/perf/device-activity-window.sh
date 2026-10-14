#!/bin/zsh
# Release-gate / budget reading (.codex/reference/performance.md): two 5 s Activity Monitor samples of the
# Dayframe process on a connected iPhone, <seconds> apart. Sends no other device commands in between.
#   DAYFRAME_DEVICE=<device UDID or name> [DAYFRAME_BUNDLE=com.layereight.dayframe.staging] \
#     scripts/perf/device-activity-window.sh [seconds=300]
# Prints cpu-total, memory-physical-footprint, memory-real and idle-wakeups at both ends; compute
# CPU % = 100 × Δcpu-total (s) ÷ seconds between the printed sample times.
set -u
DEV=${DAYFRAME_DEVICE:?Set DAYFRAME_DEVICE to the iPhone UDID or name}
BUNDLE=${DAYFRAME_BUNDLE:-com.layereight.dayframe}
WINDOW=${1:-300}
HERE=${0:A:h}
WORK=$(mktemp -d -t dayframe-perf)
trap 'rm -rf "$WORK"' EXIT

xcrun devicectl device info apps --device "$DEV" --timeout 60 --json-output "$WORK/apps.json" >/dev/null 2>&1
read BUILD CONTAINER <<< "$(DAYFRAME_BUNDLE=$BUNDLE python3 -I - "$WORK/apps.json" <<'PY'
import json, os, sys
apps = json.load(open(sys.argv[1]))["result"]["apps"]
app = next((a for a in apps if a.get("bundleIdentifier") == os.environ["DAYFRAME_BUNDLE"]), None)
print(f'{app.get("bundleVersion")} {app["url"].split("/Application/")[1].split("/")[0]}' if app else "- -")
PY
)"
PID=$(xcrun devicectl device info processes --device "$DEV" --timeout 60 2>/dev/null | grep "$CONTAINER/Dayframe.app/Dayframe *$" | awk '{print $1}' | head -1)
echo "$BUNDLE build $BUILD, pid ${PID:-not running}"
[ -n "$PID" ] || exit 1

sample() {
  local trace="$WORK/$1.trace" xml="$WORK/$1.xml"
  xcrun devicectl device info details --device "$DEV" --timeout 60 >/dev/null 2>&1
  xcrun xctrace record --template 'Activity Monitor' --device "$DEV" --all-processes --time-limit 5s --output "$trace" >/dev/null 2>&1
  xcrun xctrace export --input "$trace" --xpath '/trace-toc/run[@number="1"]/data/table[@schema="activity-monitor-process-live"]' > "$xml" 2>/dev/null
  python3 -I "$HERE/activity-monitor-parse.py" "$xml" "Dayframe ($PID)" | tail -1
}
echo "$(date +%T) start: $(sample a)"
sleep "$WINDOW"
echo "$(date +%T) end:   $(sample b)"
