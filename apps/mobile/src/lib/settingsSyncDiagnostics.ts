export function deviceSyncAttentionStatus(input: {
  timeEntryNeedsAttentionCount: number | null | undefined;
  timerStopNeedsAttentionCount: number | null | undefined;
}) {
  const timerStops = nonNegativeCount(input.timerStopNeedsAttentionCount);
  const timeEntries = nonNegativeCount(input.timeEntryNeedsAttentionCount);
  const messages = [
    timerStops > 0
      ? `${timerStops} block ${timerStops === 1 ? "Stop" : "Stops"}`
      : null,
    timeEntries > 0
      ? `${timeEntries} block ${timeEntries === 1 ? "change" : "changes"}`
      : null
  ].filter((message): message is string => Boolean(message));

  if (messages.length === 0) return null;
  return `${messages.join(" and ")} ${timerStops + timeEntries === 1 ? "needs" : "need"} attention`;
}

function nonNegativeCount(value: number | null | undefined) {
  return Math.max(0, Math.trunc(value ?? 0));
}

/**
 * A Review change whose outcome is only unknown (a check that timed out or lost connectivity) is
 * not a rejection: Dayframe re-checks it on its own (reviewSyncStore REVIEW_UNKNOWN_RECHECK_MS), and
 * it can't be discarded, so it counts as waiting, never as "needs your attention" (I1).
 */
export function splitReviewSyncIssues<T extends { resolutionStatus: string | null }>(issues: T[]) {
  const rejected: T[] = [];
  let checkingCount = 0;
  for (const issue of issues) {
    if (issue.resolutionStatus === "resolution_unknown") checkingCount += 1;
    else rejected.push(issue);
  }
  return { rejected, checkingCount };
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
  /**
   * Review changes still being checked that are not already in reviewWaitingCount. The store's
   * diagnostics count them as waiting, so Settings leaves this at 0 (I1).
   */
  reviewCheckingCount?: number;
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
    Math.max(0, count(input.reviewWaitingCount) - signIn) +
    count(input.reviewCheckingCount);
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

/**
 * Sync help › "Couldn't be sent": what is wrong with these items and what each action does. Items the
 * server refused as they are and items parked after repeated server errors are both cleared by Clear
 * (a parked Apple Health event settles its journal delivery first), and Try again sends them all now;
 * parked items are also retried now and then on passes that run anyway (no wake is scheduled).
 */
export function couldntBeSentDetail(input: { permanentFailedCount: number; parkedFailedCount: number }) {
  const total = nonNegativeCount(input.permanentFailedCount);
  const parked = Math.min(total, nonNegativeCount(input.parkedFailedCount));
  const refused = total - parked;
  const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
  if (parked === 0) {
    return `${items(total)} from this iPhone couldn't be saved. Updating Dayframe and trying again may help; clearing removes ${total === 1 ? "it" : "them"} from this iPhone.`;
  }
  if (refused === 0) {
    return `${items(total)} from this iPhone kept getting server errors. Dayframe tries ${total === 1 ? "it" : "them"} again now and then while it syncs, or you can try again now; clearing removes ${total === 1 ? "it" : "them"} from this iPhone.`;
  }
  return `${items(total)} from this iPhone couldn't be sent: ${items(refused)} couldn't be saved, and ${items(parked)} kept getting server errors (Dayframe tries ${parked === 1 ? "it" : "those"} again now and then while it syncs). Trying again may help; clearing removes all ${total} from this iPhone.`;
}

/**
 * Sync help › Places watched: how many saved places iOS is watching and how they were chosen
 * (geofenceSelection.ts, location v3 PR 16b). Counts only, never where the phone is; null while
 * no place is being watched.
 */
export function placesWatchedSummary(input: {
  geofencingActive?: boolean;
  activeMonitorCount: number;
  configuredMonitorCount?: number;
  geofenceSelection?: "all" | "nearest" | "priority";
} | null | undefined) {
  if (!input?.geofencingActive) return null;
  const watched = nonNegativeCount(input.activeMonitorCount);
  if (watched === 0) return null;
  const total = Math.max(watched, nonNegativeCount(input.configuredMonitorCount ?? watched));
  if (input.geofenceSelection === "nearest") {
    return {
      value: `${watched} of ${total}`,
      detail: "The places nearest you, and always Home and Work. Places farther away are watched when you get closer."
    };
  }
  if (input.geofenceSelection === "priority" || total > watched) {
    return {
      value: `${watched} of ${total}`,
      detail: "Your top places for now. Once Dayframe knows where you are, the places nearest you are watched."
    };
  }
  return { value: String(watched), detail: watched === 1 ? "Your saved place is watched." : "All your saved places are watched." };
}
