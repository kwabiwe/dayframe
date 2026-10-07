import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(fileURLToPath(new URL("../DayframeDashboard.tsx", import.meta.url)), "utf8");

function body(start: string) {
  const index = dashboard.indexOf(start);
  expect(index).toBeGreaterThan(-1);
  return dashboard.slice(index, dashboard.indexOf("\n  }\n", index));
}

// motion.md: haptics and landings confirm committed actions only, never refresh or rollback.
describe("Today Blocks feedback", () => {
  it("plays Start feedback only after the local start is accepted", () => {
    const start = body("function startFromToday(");
    expect(start).toMatch(/startTask\([^)]*\)\.then\(\(accepted\) => \{\s*if \(!accepted\) return;\s*playHaptic\("start"\);\s*setLiveLanding\(nextLandingRequest\(\)\);/);
  });

  it("plays the Stop composite and lands the stopped row only after the Stop intent persists", () => {
    const stop = body("function stopFromToday(");
    expect(stop).toContain("const entryId = latestData.current?.activeEntry?.id;");
    expect(stop).toMatch(/if \(!accepted \|\| !entryId\) return;\s*playHaptic\("stop"\);[\s\S]*?setLiveLanding\(null\);\s*setRowLanding\(nextLandingRequest\(\[entryId\]\)\);/);
  });

  it("warns on a committed delete and lands restored rows on Undo", () => {
    expect(dashboard).toContain('if (coordinator.activate(prepared.token)) playHaptic("delete");');
    const undo = body("function undoDeletion(");
    expect(undo).toMatch(/if \(getDeletionCoordinator\(\)\.undo\(pendingDeletion\.token\)\) \{\s*playHaptic\("undoRestore"\);\s*setRowLanding\(nextLandingRequest\(pendingDeletion\.entries\.map/);
  });

  it("never plays haptics from refresh, reconciliation or rollback paths", () => {
    const calls = [...dashboard.matchAll(/playHaptic\("(\w+)"\)/g)].map((match) => match[1]);
    expect(calls.sort()).toEqual(["delete", "delete", "start", "stop", "undoRestore"]);
    for (const path of ["function rejectOptimisticTimerStart(", "async function syncQueuedEventsAndReload("]) {
      const index = dashboard.indexOf(path);
      if (index >= 0) expect(body(path)).not.toContain("playHaptic(");
    }
  });

  it("does not fade the live block's details in on Start; the expansion only fades them out on Stop", () => {
    expect(dashboard).toMatch(/useLayoutEffect\(\(\) => \{\s*const toValue = hasLiveActiveTimer \? 1 : 0;[\s\S]*?if \(reduceMotion \|\| hasLiveActiveTimer\) \{\s*activeTimerExpansion\.setValue\(toValue\);/);
  });

  it("moves the Review summary with the card and mosaic above it", () => {
    expect(dashboard).toMatch(/<Reanimated\.View layout=\{localLayoutTransition\(reduceMotion\)\}>\s*<TodayReviewSummary/);
  });
});
