import { describe, expect, it } from "vitest";
import {
  captureDashboardRefreshGuard,
  reconcileDashboardRefreshCandidate,
  shouldApplyDashboardRefresh
} from "./dashboardRefresh";

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

  it("queues a refresh when reconnect began during a timer mutation", async () => {
    const guard = captureDashboardRefreshGuard({
      currentRevision: 8,
      timerMutationsInFlight: 1
    });

    await expect(reconcileDashboardRefreshCandidate({
      candidate: { activeEntryId: "stale-running-entry" },
      currentRevision: () => 8,
      guard,
      reconcile: async (candidate) => candidate,
      timerMutationsInFlight: () => 0
    })).resolves.toEqual({ action: "refresh" });
  });

  it("queues a refresh when a timer mutation overtakes deletion reconciliation", async () => {
    let revision = 4;
    const guard = captureDashboardRefreshGuard({
      currentRevision: revision,
      timerMutationsInFlight: 0
    });

    await expect(reconcileDashboardRefreshCandidate({
      candidate: { entryIds: ["entry-a", "entry-deleted"] },
      currentRevision: () => revision,
      guard,
      reconcile: async (candidate) => {
        revision += 1;
        return { entryIds: candidate.entryIds.filter((id) => id !== "entry-deleted") };
      },
      timerMutationsInFlight: () => 0
    })).resolves.toEqual({ action: "refresh" });
  });

  it("applies a recovered bootstrap only after deletion reconciliation", async () => {
    const guard = captureDashboardRefreshGuard({
      currentRevision: 3,
      timerMutationsInFlight: 0
    });

    await expect(reconcileDashboardRefreshCandidate({
      candidate: { entryIds: ["entry-a", "entry-deleted"] },
      currentRevision: () => 3,
      guard,
      reconcile: async (candidate) => ({
        entryIds: candidate.entryIds.filter((id) => id !== "entry-deleted")
      }),
      timerMutationsInFlight: () => 0
    })).resolves.toEqual({
      action: "apply",
      candidate: { entryIds: ["entry-a"] }
    });
  });
});
