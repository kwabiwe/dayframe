import { describe, expect, it } from "vitest";
import { deviceSyncAttentionStatus, splitReviewSyncIssues, syncHelpStatus } from "./settingsSyncDiagnostics";

describe("Settings sync diagnostics summary", () => {
  it("reports block Stop and time-entry attention together", () => {
    expect(deviceSyncAttentionStatus({
      timerStopNeedsAttentionCount: 1,
      timeEntryNeedsAttentionCount: 2
    })).toBe("1 block Stop and 2 block changes need attention");
  });

  it("keeps singular and empty attention summaries clear", () => {
    expect(deviceSyncAttentionStatus({
      timerStopNeedsAttentionCount: 0,
      timeEntryNeedsAttentionCount: 1
    })).toBe("1 block change needs attention");
    expect(deviceSyncAttentionStatus({
      timerStopNeedsAttentionCount: undefined,
      timeEntryNeedsAttentionCount: null
    })).toBeNull();
  });
});

describe("syncHelpStatus", () => {
  const none = {
    timerStopIssueCount: 0, timeEntryIssueCount: 0, reviewIssueCount: 0, permanentFailedCount: 0,
    quarantinedCount: 0, deviceQuarantinedCount: 0, queuedCount: 0, timerStopPendingCount: 0,
    timeEntryPendingCount: 0, reviewWaitingCount: 0, reviewSignInCount: 0
  };

  it.each([
    ["nothing pending", {}, "idle", "Nothing is waiting", "Everything is up to date"],
    ["an item retrying on its own", { queuedCount: 1 }, "waiting", "1 change waiting to send", "1 change waiting to send"],
    ["a permanent queue failure", { queuedCount: 1, permanentFailedCount: 1 }, "attention", "Something needs your attention", "Something needs your attention"],
    ["unreadable records only", { deviceQuarantinedCount: 2 }, "attention", "Something needs your attention", "Something needs your attention"],
    ["a rejected Stop", { timerStopIssueCount: 1 }, "attention", "Something needs your attention", "Something needs your attention"],
    ["Review changes needing a sign-in", { reviewWaitingCount: 2, reviewSignInCount: 2 }, "sign_in", "Sign in to send your changes", "Sign in to send your changes"],
    ["Review changes waiting", { reviewWaitingCount: 3 }, "waiting", "3 changes waiting to send", "3 changes waiting to send"]
  ])("%s", (_name, overrides, kind, title, indexTitle) => {
    const status = syncHelpStatus({ ...none, ...overrides });
    expect(status.kind).toBe(kind);
    expect(status.title).toBe(title);
    expect(status.indexTitle).toBe(indexTitle);
  });

  it("counts one Needs attention row per rejection, plus one for queue failures and one for unreadable records", () => {
    const status = syncHelpStatus({ ...none, timerStopIssueCount: 1, timeEntryIssueCount: 2, reviewIssueCount: 1, permanentFailedCount: 4, quarantinedCount: 1, deviceQuarantinedCount: 1 });
    expect(status.issueCount).toBe(6);
    expect(status.indexDetail).toContain("Something not syncing?");
  });

  it("does not count sign-in Review changes as waiting", () => {
    expect(syncHelpStatus({ ...none, queuedCount: 1, reviewWaitingCount: 2, reviewSignInCount: 2 }).kind).toBe("sign_in");
  });
});

describe("offline is never 'needs your attention' (I1)", () => {
  const none = {
    timerStopIssueCount: 0, timeEntryIssueCount: 0, reviewIssueCount: 0, permanentFailedCount: 0,
    quarantinedCount: 0, deviceQuarantinedCount: 0, queuedCount: 0, timerStopPendingCount: 0,
    timeEntryPendingCount: 0, reviewWaitingCount: 0, reviewSignInCount: 0
  };

  it("counts a Review change with an unknown outcome as waiting, not a rejection", () => {
    const { rejected, checkingCount } = splitReviewSyncIssues([
      { id: "a", resolutionStatus: "resolution_unknown" },
      { id: "b", resolutionStatus: "resolution_conflict" },
      { id: "c", resolutionStatus: null }
    ]);
    expect(rejected.map((issue) => issue.id)).toEqual(["b", "c"]);
    expect(checkingCount).toBe(1);
  });

  it("shows only 'waiting' while offline with retryable work and unknown Review outcomes", () => {
    const status = syncHelpStatus({ ...none, queuedCount: 2, timerStopPendingCount: 1, timeEntryPendingCount: 1, reviewWaitingCount: 1, reviewCheckingCount: 1 });
    expect(status.kind).toBe("waiting");
    expect(status.title).toBe("6 changes waiting to send");
    expect(status.indexTitle).not.toContain("attention");
  });

  it("still asks for attention for a real permanent rejection", () => {
    for (const rejection of [{ timerStopIssueCount: 1 }, { timeEntryIssueCount: 1 }, { reviewIssueCount: 1 }, { permanentFailedCount: 1 }]) {
      expect(syncHelpStatus({ ...none, queuedCount: 3, reviewCheckingCount: 2, ...rejection }).kind).toBe("attention");
    }
  });
});
