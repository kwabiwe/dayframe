import { describe, expect, it } from "vitest";
import { shouldApplyDashboardRefresh } from "./dashboardRefresh";

describe("mobile dashboard refresh ordering", () => {
  it("accepts a background refresh when no local timer mutation overtook it", () => {
    expect(shouldApplyDashboardRefresh({
      startedRevision: 4,
      currentRevision: 4,
      timerMutationsInFlight: 0
    })).toBe(true);
  });

  it("rejects a launch refresh that resolves after Play created an optimistic timer", () => {
    expect(shouldApplyDashboardRefresh({
      startedRevision: 4,
      currentRevision: 5,
      timerMutationsInFlight: 1
    })).toBe(false);
  });

  it("rejects server snapshots while a timer mutation is still being persisted", () => {
    expect(shouldApplyDashboardRefresh({
      startedRevision: 5,
      currentRevision: 5,
      timerMutationsInFlight: 1
    })).toBe(false);
  });
});
