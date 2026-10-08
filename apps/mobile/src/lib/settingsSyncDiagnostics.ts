export function deviceSyncAttentionStatus(input: {
  timeEntryNeedsAttentionCount: number | null | undefined;
  timerStopNeedsAttentionCount: number | null | undefined;
}) {
  const timerStops = nonNegativeCount(input.timerStopNeedsAttentionCount);
  const timeEntries = nonNegativeCount(input.timeEntryNeedsAttentionCount);
  const messages = [
    timerStops > 0
      ? `${timerStops} timer ${timerStops === 1 ? "Stop" : "Stops"}`
      : null,
    timeEntries > 0
      ? `${timeEntries} time entry ${timeEntries === 1 ? "change" : "changes"}`
      : null
  ].filter((message): message is string => Boolean(message));

  if (messages.length === 0) return null;
  return `${messages.join(" and ")} ${timerStops + timeEntries === 1 ? "needs" : "need"} attention`;
}

function nonNegativeCount(value: number | null | undefined) {
  return Math.max(0, Math.trunc(value ?? 0));
}

/**
 * Settings › Help and Sync help: one plain status for everything waiting on this iPhone.
 * Only changes that need a choice (permanent rejections, unconfirmed Review choices, unreadable
 * records) are "attention"; anything still retrying on its own is "waiting" (AGENTS: background).
 */
export type SyncHelpStatus = {
  kind: "attention" | "sign_in" | "waiting" | "idle";
  /** Rows in Sync help › Needs attention. */
  issueCount: number;
  title: string;
  detail: string;
  /** The same status for the Settings index Help row (which has no list under it). */
  indexTitle: string;
  indexDetail: string;
};

export function syncHelpStatus(input: {
  timerStopIssueCount: number;
  timeEntryIssueCount: number;
  reviewIssueCount: number;
  permanentFailedCount: number;
  quarantinedCount: number;
  deviceQuarantinedCount: number;
  queuedCount: number;
  timerStopPendingCount: number;
  timeEntryPendingCount: number;
  reviewWaitingCount: number;
  reviewSignInCount: number;
}): SyncHelpStatus {
  const count = nonNegativeCount;
  const issueCount =
    count(input.timerStopIssueCount) +
    count(input.timeEntryIssueCount) +
    count(input.reviewIssueCount) +
    (count(input.permanentFailedCount) > 0 ? 1 : 0) +
    (count(input.quarantinedCount) > 0 || count(input.deviceQuarantinedCount) > 0 ? 1 : 0);
  const signIn = count(input.reviewSignInCount);
  // Review's waiting count includes changes that need a sign-in; those get their own line.
  const waiting =
    count(input.queuedCount) +
    count(input.timerStopPendingCount) +
    count(input.timeEntryPendingCount) +
    Math.max(0, count(input.reviewWaitingCount) - signIn);
  if (issueCount > 0) {
    return {
      kind: "attention",
      issueCount,
      title: "Something needs your attention",
      detail: "Choose what to do with each change below.",
      indexTitle: "Something needs your attention",
      indexDetail: "Open “Something not syncing?” to choose what to do."
    };
  }
  if (signIn > 0) {
    const detail = `${signIn} Review ${signIn === 1 ? "change is" : "changes are"} saved on this iPhone. Sign in again to send ${signIn === 1 ? "it" : "them"}.`;
    return { kind: "sign_in", issueCount, title: "Sign in to send your changes", detail, indexTitle: "Sign in to send your changes", indexDetail: detail };
  }
  if (waiting > 0) {
    const title = `${waiting} ${waiting === 1 ? "change" : "changes"} waiting to send`;
    const detail = "They send on their own when you're online.";
    return { kind: "waiting", issueCount, title, detail, indexTitle: title, indexDetail: detail };
  }
  return {
    kind: "idle",
    issueCount,
    title: "Nothing is waiting",
    detail: "All your changes are saved.",
    indexTitle: "Everything is up to date",
    indexDetail: "All your changes are saved."
  };
}
