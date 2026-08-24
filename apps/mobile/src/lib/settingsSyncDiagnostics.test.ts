import { describe, expect, it } from "vitest";
import { deviceSyncAttentionStatus } from "./settingsSyncDiagnostics";

describe("Settings sync diagnostics summary", () => {
  it("reports timer Stop and time-entry attention together", () => {
    expect(deviceSyncAttentionStatus({
      timerStopNeedsAttentionCount: 1,
      timeEntryNeedsAttentionCount: 2
    })).toBe("1 timer Stop and 2 time entry changes need attention");
  });

  it("keeps singular and empty attention summaries clear", () => {
    expect(deviceSyncAttentionStatus({
      timerStopNeedsAttentionCount: 0,
      timeEntryNeedsAttentionCount: 1
    })).toBe("1 time entry change needs attention");
    expect(deviceSyncAttentionStatus({
      timerStopNeedsAttentionCount: undefined,
      timeEntryNeedsAttentionCount: null
    })).toBeNull();
  });
});
