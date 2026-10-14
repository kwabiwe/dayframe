import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("./DayframeDashboard.tsx", import.meta.url), "utf8");

describe("shortcut Stop hand-off contract", () => {
  it("the Dashboard hands Stop requests to its targeted Stop only when authenticated with timer state", () => {
    expect(dashboard).toContain("useShortcutStopHandoff(authState === \"authenticated\" && data !== null, () => stopActiveTimerRef.current());");
    expect(dashboard).toContain("stopActiveTimerRef.current = stopActiveTimer;");
    // stopActiveTimer persists a Stop aimed at the running entry, never an untargeted one.
    const stop = dashboard.slice(dashboard.indexOf("async function stopActiveTimer()"), dashboard.indexOf("async function deleteActiveTimer("));
    expect(stop).toContain("persistPendingTimerStop({");
    expect(stop).toContain("{ targetEntryId: persistedId }");
  });
});
