import { describe, expect, it } from "vitest";
import { healthSyncNote, mergeHealthStatuses } from "./healthSyncNote";
import type { ManualSyncResult } from "./syncCoordinator";
import type { HealthImportStatus } from "./health";

function result(sleep: Partial<ManualSyncResult["lanes"]["sleep"]>, workouts: Partial<ManualSyncResult["lanes"]["workouts"]>): ManualSyncResult {
  const complete = { outcome: "complete" as const };
  return {
    startedAt: "2026-10-09T08:00:00.000Z",
    finishedAt: "2026-10-09T08:00:02.000Z",
    lanes: {
      sleep: { ...complete, ...sleep },
      workouts: { ...complete, ...workouts },
      activity: complete,
      review: complete,
      location: complete,
      refresh: complete
    }
  };
}

describe("healthSyncNote", () => {
  it("says synced only when the Health lanes completed", () => {
    expect(healthSyncNote(result({}, {}))).toBe("Synced just now.");
    expect(healthSyncNote(result({ outcome: "transport_failure" }, {}))).toMatch(/^Couldn't reach Dayframe/);
    expect(healthSyncNote(result({}, { outcome: "server_busy" }))).toMatch(/^Couldn't reach Dayframe/);
    expect(healthSyncNote(result({ outcome: "needs_attention" }, {}))).toMatch(/needs attention/);
    expect(healthSyncNote(result({}, { outcome: "cancelled" }))).toBe("Sync didn't finish. Dayframe keeps trying on its own.");
    expect(healthSyncNote(result({ outcome: "partial" }, {}))).toBe("Sync didn't finish. Dayframe keeps trying on its own.");
    expect(healthSyncNote(result({ outcome: "authentication_required" }, {}))).toBe("Sign in again to sync Apple Health.");
    expect(healthSyncNote(null)).toMatch(/^Couldn't sync/);
  });

  it("ignores a lane that is switched off", () => {
    expect(healthSyncNote(result({ outcome: "complete", stage: "disabled" }, {}))).toBe("Synced just now.");
    expect(healthSyncNote(result({ stage: "disabled" }, { stage: "disabled" }))).toBe("Nothing to sync: every Health type is off.");
  });
});

describe("mergeHealthStatuses", () => {
  const permission: HealthImportStatus = { provider: "healthkit", kind: "permissions", status: "available", notes: "" };
  const availability: HealthImportStatus = { provider: "healthkit", kind: "availability", status: "available", notes: "" };
  it("keeps the connection record when availability is re-read", () => {
    const merged = mergeHealthStatuses([permission, { ...availability, status: "unavailable" }], [availability]);
    expect(merged).toContainEqual(permission);
    expect(merged.filter((status) => status.kind === "availability")).toEqual([availability]);
  });
});
