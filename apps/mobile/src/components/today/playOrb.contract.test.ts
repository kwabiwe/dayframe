import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const layout = read("../../../app/(tabs)/_layout.tsx");
const dashboard = read("../DayframeDashboard.tsx");
const slot = read("../../../app/(tabs)/orb.tsx");
const orb = read("./PlayOrb.tsx");

function body(start: string) {
  const index = dashboard.indexOf(start);
  expect(index).toBeGreaterThan(-1);
  return dashboard.slice(index, dashboard.indexOf("\n  }\n", index));
}

describe("Play orb wiring (Blocks parity step 3)", () => {
  it("reserves the tab bar's trailing slot with a disabled search-role item whose press is the orb's tap", () => {
    const trigger = layout.slice(layout.indexOf("<NativeTabs.Trigger\n"), layout.indexOf("</NativeTabs>"));
    expect(trigger).toContain('accessibilityLabel={timerRunning ? "Stop timer" : "Start a block"}');
    expect(trigger).toMatch(/\bdisabled\b/);
    // Fixed for the process: toggling it at runtime would re-key the tab view and remount every tab.
    expect(trigger).toContain("hidden={!PLAY_ORB_SLOT}");
    expect(layout).not.toContain("usePlayOrbAvailable");
    expect(trigger).toMatch(/listeners=\{\{\s*tabPress: \(\) => requestPlayOrbTap\(\)\s*\}\}/);
    expect(trigger).toContain('name={DAYFRAME_NATIVE_TABS.orb.route}');
    expect(trigger).toContain('role="search"');
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
    expect(dashboard).toContain("hidden={!playOrbAvailable || (reportsSheetPortal?.isPresented ?? false)}");
    expect(dashboard).toContain('const playOrbAvailable = authState === "authenticated" && PLAY_ORB_SUPPORTED;');
    expect(dashboard).not.toContain("setPlayOrbAvailable");
    // The memoised orb only ever gets stable callbacks that run the current render's actions.
    expect(dashboard).toContain("onTap={onPlayOrbTapStable}");
    expect(dashboard).toContain("onChoose={onPlayOrbChooseStable}");
    expect(dashboard).toContain("const onPlayOrbTapStable = useCallback(() => tapPlayOrbRef.current(), []);");
    expect(dashboard).toContain("setPlayOrbRunning(hasLiveActiveTimer);");
    expect(dashboard).toContain("useEffect(() => onPlayOrbTap(() => tapPlayOrbRef.current()), []);");
  });

  it("presses in place under Reduce Motion and hit-tests bubbles in window points", () => {
    expect(orb).toContain("scale.value = reduceMotion ? 0.9 : withSpring(0.9,");
    expect(orb).toContain("scale.value = reduceMotion ? 1 : withSpring(1,");
    expect(orb).toContain("bloomHit(spotOffsets.value, event.absoluteX - orbCenterX.value, event.absoluteY - orbCenterY.value)");
    // The 1 s clock lives in the ring, so the Dashboard's tick never rebuilds the orb's gesture.
    expect(orb).toContain("function OrbSecondsRing(");
    expect(orb).not.toContain("nowMs: number;\n  onChoose");
  });
});
