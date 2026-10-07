import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const layout = read("../../../app/(tabs)/_layout.tsx");
const dashboard = read("../DayframeDashboard.tsx");
const slot = read("../../../app/(tabs)/orb.tsx");

function body(start: string) {
  const index = dashboard.indexOf(start);
  expect(index).toBeGreaterThan(-1);
  return dashboard.slice(index, dashboard.indexOf("\n  }\n", index));
}

describe("Play orb wiring (Blocks parity step 3)", () => {
  it("reserves the tab bar's trailing slot with a disabled search-role item whose press is the orb's tap", () => {
    expect(layout).toMatch(/<NativeTabs\.Trigger\s+disabled\s+listeners=\{\{\s*tabPress: \(\) => requestPlayOrbTap\(\)\s*\}\}\s+name=\{DAYFRAME_NATIVE_TABS\.orb\.route\}\s+role="search"/);
    expect(layout).toContain('{timerRunning ? "Stop timer" : "Start a block"}');
    // A deep link to the slot lands on Today; nothing navigates there.
    expect(slot).toContain('<Redirect href="/today" />');
    expect(dashboard).not.toMatch(/router\.(push|replace|navigate)\(["']\/orb/);
  });

  it("taps start a bare block, or stop (flying only on Today), and never start a duplicate", () => {
    const tap = body("function tapPlayOrb(");
    expect(tap).toMatch(/if \(!entryId\) \{\s*startFromToday\(null\);\s*return;\s*\}/);
    expect(tap).toMatch(/if \(todayTabFocused\.current\) stopFromToday\(\);\s*else runStopFromToday\(entryId, null\);/);
    const choose = body("function chooseFromPlayOrb(");
    expect(choose).toMatch(/active\.categoryId === activityId\) \{\s*presentActiveEditor\("existing_active_timer"\);\s*return;/);
    expect(choose).toContain("startFromToday(activityId);");
  });

  it("hides with the tab bar and keeps the native item's label in step with the timer", () => {
    expect(dashboard).toContain("hidden={reportsSheetPortal?.isPresented ?? false}");
    expect(dashboard).toContain("setPlayOrbRunning(hasLiveActiveTimer);");
    expect(dashboard).toContain("useEffect(() => onPlayOrbTap(() => tapPlayOrbRef.current()), []);");
  });
});
