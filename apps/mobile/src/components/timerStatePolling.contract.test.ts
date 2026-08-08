import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)),
  "utf8"
);

describe("mobile timer-state polling contracts", () => {
  it("checks only while active and reconciles through the guarded dashboard loader", () => {
    expect(dashboardSource).toContain("const fetched = await fetchTimerState()");
    expect(dashboardSource).toContain(
      "await reconcilePendingActiveDeletionAfterQueueBarrier(\n          fetched.activeEntryId"
    );
    expect(dashboardSource).toContain("tombstones.has(fetched.activeEntryId)");
    expect(dashboardSource).toContain("timerStateChanged(timerStateRef.current, next)");
    expect(dashboardSource).toContain("await loadRef.current({ silent: true })");
    expect(dashboardSource).toContain('AppState.currentState !== "active"');
    expect(dashboardSource).toContain('if (state === "active")');
  });

  it("allows one timer-state request at a time and backs failures off", () => {
    expect(dashboardSource).toContain("timerStatePollInFlight.current");
    expect(dashboardSource).toContain("timerStatePollDelay(consecutiveFailures)");
    expect(dashboardSource).toContain("TIMER_STATE_RECONCILE_INTERVAL_MS");
    expect(dashboardSource).not.toContain("}, 30000);");
  });
});
