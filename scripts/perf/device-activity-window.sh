#!/bin/zsh
# Release-gate / budget reading (.codex/reference/performance.md): two 5 s Activity Monitor samples of the
# Dayframe process on a connected iPhone, <seconds> apart. Sends no other device commands in between.
#   DAYFRAME_DEVICE=<device UDID or name> [DAYFRAME_BUNDLE=com.layereight.dayframe.staging] \
#     scripts/perf/device-activity-window.sh [seconds=300]
# Prints both Activity Monitor rows (cpu-total, footprint, memory-real, idle-wakeups) with the time each
# row was sampled, then CPU % = 100 × Δcpu-total ÷ elapsed seconds and the footprint slope. Exits non-zero
# unless both samples are complete.
set -u
DEV=${DAYFRAME_DEVICE:?Set DAYFRAME_DEVICE to the iPhone UDID or name}
BUNDLE=${DAYFRAME_BUNDLE:-com.layereight.dayframe}
WINDOW=${1:-300}
[[ "$WINDOW" == <1-> ]] || { echo "The window must be a whole number of seconds" >&2; exit 2; }
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

# One sample: prints "<epoch seconds> <time> | <Activity Monitor row>". The time is the recording's own
# start (its table of contents) plus the selected row's offset, so set-up delays never skew the window.
sample() {
  local trace="$WORK/$1.trace" xml="$WORK/$1.xml" row t0
  xcrun devicectl device info details --device "$DEV" --timeout 60 >/dev/null 2>&1
  xcrun xctrace record --template 'Activity Monitor' --device "$DEV" --all-processes --time-limit 5s --output "$trace" >/dev/null 2>&1 \
    || { echo "recording failed" >&2; return 1; }
  xcrun xctrace export --input "$trace" --xpath '/trace-toc/run[@number="1"]/data/table[@schema="activity-monitor-process-live"]' > "$xml" 2>/dev/null \
    || { echo "export failed" >&2; return 1; }
  t0=$(xcrun xctrace export --input "$trace" --toc 2>/dev/null | python3 -I -c '
import re, sys
from datetime import datetime
match = re.search(r"<start-date>([^<]+)</start-date>", sys.stdin.read())
print(f"{datetime.fromisoformat(match.group(1)).timestamp():.3f}" if match else "")') 
  [ -n "$t0" ] || { echo "the recording has no start date" >&2; return 1; }
  row=$(python3 -I "$HERE/activity-monitor-parse.py" "$xml" "Dayframe ($PID)" | tail -1)
  local field
  for field in cpu-total memory-physical-footprint memory-real idle-wakeups; do
    [[ "$row" == *"$field="* && "$row" != *"$field=None"* ]] || { echo "no complete Dayframe ($PID) row in the recording ($field)" >&2; return 1; }
  done
  python3 -I - "$t0" "$row" <<'PY'
import sys, time
t0, row = float(sys.argv[1]), sys.argv[2]
offset = row.split("start=", 1)[1].split(" |", 1)[0]  # mm:ss.mmm.uuu
minutes, rest = offset.split(":", 1)
seconds = int(minutes) * 60 + float(".".join(rest.split(".")[:2]))
at = t0 + seconds
print(f"{at:.3f} {time.strftime('%H:%M:%S', time.localtime(at))} | {row}")
PY
}
a=$(sample a) || exit 1
echo "start: $a"
sleep "$WINDOW" || exit 1
b=$(sample b) || exit 1
echo "end:   $b"
python3 -I - "$a" "$b" <<'PY'
import re, sys
def parse(line):
    at = float(line.split()[0])
    cpu = re.search(r"cpu-total=([\d.,]+) (s|min|ms)", line)
    mem = re.search(r"memory-physical-footprint=([\d.,]+) (KiB|MiB|GiB)", line)
    value = float(cpu.group(1).replace(",", "")) * {"ms": 0.001, "s": 1, "min": 60}[cpu.group(2)]
    mib = float(mem.group(1).replace(",", "")) * {"KiB": 1 / 1024, "MiB": 1, "GiB": 1024}[mem.group(2)]
    return at, value, mib
(a_at, a_cpu, a_mem), (b_at, b_cpu, b_mem) = parse(sys.argv[1]), parse(sys.argv[2])
elapsed = b_at - a_at
print(f"window {elapsed:.0f} s: CPU {100 * (b_cpu - a_cpu) / elapsed:.1f} % of a core, "
      f"footprint {b_mem - a_mem:+.1f} MiB ({(b_mem - a_mem) * 60 / elapsed:+.2f} MiB a minute)")
PY
