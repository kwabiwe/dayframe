import { describe, expect, it } from "vitest";
import {
  LOCATION_SERVER_REPLAY_INTERVAL_MS,
  locationUploadDisposition,
  partitionAcknowledgedEvidence,
  shouldRequestLocationReplay
} from "./uploadPolicy";

describe("location upload policy", () => {
  it("treats permanent schema failures as terminal so later evidence can proceed", () => {
    expect(locationUploadDisposition(400)).toBe("reject");
    expect(locationUploadDisposition(422)).toBe("reject");
    expect(locationUploadDisposition(500)).toBe("retry");
  });

  it("returns unacknowledged items to the retry path after a partial response", () => {
    expect(partitionAcknowledgedEvidence(["a", "b", "c"], ["a", "c"])).toEqual({
      acknowledgedIds: ["a", "c"],
      retryIds: ["b"]
    });
  });

  it("requests replay after uploads, on foreground, or after the periodic interval", () => {
    const now = Date.parse("2026-08-11T12:00:00.000Z");
    expect(shouldRequestLocationReplay({ force: true, uploadedBatchCount: 0, lastAttemptAt: new Date(now).toISOString(), now })).toBe(true);
    expect(shouldRequestLocationReplay({ force: false, uploadedBatchCount: 1, lastAttemptAt: new Date(now).toISOString(), now })).toBe(true);
    expect(shouldRequestLocationReplay({ force: false, uploadedBatchCount: 0, lastAttemptAt: null, now })).toBe(true);
    expect(shouldRequestLocationReplay({
      force: false,
      uploadedBatchCount: 0,
      lastAttemptAt: new Date(now - LOCATION_SERVER_REPLAY_INTERVAL_MS + 1).toISOString(),
      now
    })).toBe(false);
    expect(shouldRequestLocationReplay({
      force: false,
      uploadedBatchCount: 0,
      lastAttemptAt: new Date(now - LOCATION_SERVER_REPLAY_INTERVAL_MS).toISOString(),
      now
    })).toBe(true);
  });
});
