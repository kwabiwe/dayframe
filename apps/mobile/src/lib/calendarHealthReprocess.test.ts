import { beforeEach, describe, expect, it, vi } from "vitest";

const health = vi.hoisted(() => ({
  reprocess: vi.fn(),
  captureEnabled: vi.fn(async () => false),
  importSleep: vi.fn(async () => { throw new Error("capture failed"); }),
  importWorkouts: vi.fn(async () => { throw new Error("capture failed"); })
}));
vi.mock("./health", () => ({
  reprocessExistingHealthReviewItems: health.reprocess,
  isHealthKitAutomaticSyncEnabled: health.captureEnabled,
  importHealthKitSleep: health.importSleep,
  importHealthKitWorkouts: health.importWorkouts
}));
vi.mock("./api", () => ({ AuthRequiredError: class AuthRequiredError extends Error {} }));

import { AuthRequiredError } from "./api";
import {
  CALENDAR_HEALTH_REPROCESS_DEADLINE_MS,
  CALENDAR_HEALTH_REPROCESS_INTERVAL_MS,
  reprocessHealthOnCalendarFront,
  resetCalendarHealthReprocessForTests
} from "./calendarHealthReprocess";

const result = (changes: Partial<Record<"confirmedCount" | "ignoredCount" | "updatedCategoryCount" | "repairedSleepEntryCount", number>> = {}) => ({
  ok: true, checkedCount: 1, confirmedCount: 0, ignoredCount: 0, leftInReviewCount: 1, skippedCount: 0, failedCount: 0,
  updatedCategoryCount: 0, repairedSleepEntryCount: 0, ...changes
});

describe("Health reprocess when Calendar › List comes to front (step 15; Codex r1 on #615)", () => {
  beforeEach(() => {
    resetCalendarHealthReprocessForTests();
    health.reprocess.mockReset();
    health.captureEnabled.mockClear();
    health.importSleep.mockClear();
    health.importWorkouts.mockClear();
  });

  it("forces the server's reprocess with capture off or failing, never touching capture, inside its deadline", async () => {
    health.reprocess.mockResolvedValue(result({ confirmedCount: 1 }));
    const now = 1_000_000;
    await expect(reprocessHealthOnCalendarFront({ ownerKey: "a", isCurrentOwner: () => true, now })).resolves.toBe("changed");
    expect(health.reprocess).toHaveBeenCalledWith(undefined, expect.objectContaining({ force: true, deadlineAt: now + CALENDAR_HEALTH_REPROCESS_DEADLINE_MS }));
    expect(health.captureEnabled).not.toHaveBeenCalled();
    expect(health.importSleep).not.toHaveBeenCalled();
    expect(health.importWorkouts).not.toHaveBeenCalled();
  });

  it("runs at most once per account per interval, a failed attempt included", async () => {
    health.reprocess.mockRejectedValueOnce(new Error("server")).mockResolvedValue(result());
    const now = 5_000_000;
    await expect(reprocessHealthOnCalendarFront({ ownerKey: "a", isCurrentOwner: () => true, now })).resolves.toBe("failed");
    await expect(reprocessHealthOnCalendarFront({ ownerKey: "a", isCurrentOwner: () => true, now: now + 60_000 })).resolves.toBe("throttled");
    // Another account has its own interval.
    await expect(reprocessHealthOnCalendarFront({ ownerKey: "b", isCurrentOwner: () => true, now: now + 60_000 })).resolves.toBe("unchanged");
    await expect(reprocessHealthOnCalendarFront({ ownerKey: "a", isCurrentOwner: () => true, now: now + CALENDAR_HEALTH_REPROCESS_INTERVAL_MS }))
      .resolves.toBe("unchanged");
    expect(health.reprocess).toHaveBeenCalledTimes(3);
  });

  it("stops at the next batch once the account changes, and reports nothing for the old one", async () => {
    let current = true;
    health.reprocess.mockImplementation(async (_preferences, options: { beforeRequest: () => Promise<boolean> }) => {
      current = false;
      expect(await options.beforeRequest()).toBe(false);
      return result({ confirmedCount: 2 });
    });
    await expect(reprocessHealthOnCalendarFront({ ownerKey: "a", isCurrentOwner: () => current })).resolves.toBe("stale");
  });

  it("hands a signed-out session to the caller", async () => {
    health.reprocess.mockRejectedValue(new AuthRequiredError());
    await expect(reprocessHealthOnCalendarFront({ ownerKey: "a", isCurrentOwner: () => true })).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
