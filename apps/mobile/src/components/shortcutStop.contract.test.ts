import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("./DayframeDashboard.tsx", import.meta.url), "utf8");

describe("shortcut Stop hand-off contract", () => {
  it("the Dashboard takes a Stop request only with loaded timer state and stops through its targeted Stop", () => {
    const effect = dashboard.slice(dashboard.indexOf("const take = () => {"), dashboard.indexOf("}, [authState, data]);"));
    expect(effect).toContain('if (authState !== "authenticated" || !latestData.current) return;');
    expect(effect).toContain("if (takeShortcutStopRequest()) void stopActiveTimerRef.current();");
    expect(effect).toContain("return subscribeShortcutStopRequests(take);");
    expect(dashboard).toContain("stopActiveTimerRef.current = stopActiveTimer;");
    // stopActiveTimer persists a Stop aimed at the running entry, never an untargeted one.
    const stop = dashboard.slice(dashboard.indexOf("async function stopActiveTimer()"), dashboard.indexOf("async function deleteActiveTimer("));
    expect(stop).toContain("persistPendingTimerStop({");
    expect(stop).toContain("{ targetEntryId: persistedId }");
  });
});
