import { getQueueDiagnostics, readQueue, subscribeActivityQueue } from "./api";
import { IS_DAYFRAME_STAGING } from "./config";
import {
  mobileAccountKey,
  readActiveMobileAccount,
  subscribeActiveMobileAccount
} from "./mobileAccount";
import {
  getActiveReviewAccountIdentity,
  getReviewSyncDiagnostics,
  subscribeReviewSync
} from "./reviewSyncStore";
import {
  getActiveLocationAccountIdentity,
  getLocationStoreDiagnostics,
  subscribeLocationStore
} from "./location/store";
import {
  getTimeEntryOutboxDiagnostics,
  subscribeTimeEntryOutbox
} from "./timeEntryOutbox";
import {
  pendingTimerStopsForOwner,
  readPendingTimerStops,
  subscribeTimerStopOutbox
} from "./timerStopOutbox";
import { getNativeShortcutPendingCount } from "./shortcuts";
import { getNativeLocationIntelligenceStatus } from "./location/runtime";

export type DurableWorkSnapshot = {
  accountKey: string | null;
  activityCount: number;
  nativeShortcutCount: number;
  timerStopCount: number;
  timeEntryCommandCount: number;
  timeEntryNeedsAttentionCount: number;
  timeEntryQuarantinedCount: number;
  timeEntryDeviceQuarantinedCount: number;
  reviewCount: number;
  locationCount: number;
  nativeLocationSignalCount: number;
  pendingCount: number;
  nextRetryAt: string | null;
  lastError: string | null;
  revision: number;
};

const EMPTY_SNAPSHOT: DurableWorkSnapshot = {
  accountKey: null,
  activityCount: 0,
  nativeShortcutCount: 0,
  timerStopCount: 0,
  timeEntryCommandCount: 0,
  timeEntryNeedsAttentionCount: 0,
  timeEntryQuarantinedCount: 0,
  timeEntryDeviceQuarantinedCount: 0,
  reviewCount: 0,
  locationCount: 0,
  nativeLocationSignalCount: 0,
  pendingCount: 0,
  nextRetryAt: null,
  lastError: null,
  revision: 0
};

let snapshot = EMPTY_SNAPSHOT;
let referenceCount = 0;
let refreshPromise: Promise<DurableWorkSnapshot> | null = null;
let refreshRequested = false;
let unsubscribers: Array<() => void> = [];
const listeners = new Set<() => void>();

export function startDurableWorkMonitor() {
  referenceCount += 1;
  if (referenceCount === 1) {
    const request = () => void refreshDurableWorkSnapshot();
    unsubscribers = [
      subscribeActiveMobileAccount(request),
      subscribeActivityQueue(request),
      subscribeTimerStopOutbox(request),
      subscribeTimeEntryOutbox(request),
      subscribeReviewSync(request),
      subscribeLocationStore(request)
    ];
    void readActiveMobileAccount().then(request, request);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    referenceCount = Math.max(0, referenceCount - 1);
    if (referenceCount === 0) {
      for (const unsubscribe of unsubscribers) unsubscribe();
      unsubscribers = [];
    }
  };
}

export function subscribeDurableWork(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDurableWorkSnapshot() {
  return snapshot;
}

export function refreshDurableWorkSnapshot(): Promise<DurableWorkSnapshot> {
  refreshRequested = true;
  refreshPromise ??= runRequestedRefreshes().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export function __resetDurableWorkMonitorForTests() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];
  referenceCount = 0;
  refreshPromise = null;
  refreshRequested = false;
  snapshot = EMPTY_SNAPSHOT;
  listeners.clear();
}

async function runRequestedRefreshes() {
  while (refreshRequested) {
    refreshRequested = false;
    await refreshOnce();
  }
  return snapshot;
}

async function refreshOnce() {
  const owner = await readActiveMobileAccount();
  if (!owner) {
    publish({ ...EMPTY_SNAPSHOT, revision: snapshot.revision + 1 });
    return;
  }

  const [
    queue,
    stops,
    timeEntries,
    review,
    reviewOwner,
    location,
    locationOwner,
    nativeShortcutCount,
    nativeLocationSignalCount
  ] = await Promise.all([
    readQueue(owner),
    readPendingTimerStops(),
    getTimeEntryOutboxDiagnostics(owner),
    getReviewSyncDiagnostics(),
    getActiveReviewAccountIdentity(),
    getLocationStoreDiagnostics(),
    getActiveLocationAccountIdentity(),
    getNativeShortcutPendingCount(owner).catch(() => 0),
    getNativeLocationIntelligenceStatus()
      .then((status) => status.pendingSignalCount ?? 0)
      .catch(() => 0)
  ]);
  const activityDiagnostics = getQueueDiagnostics(queue);
  const queuedActivityCount = queue.filter((event) => event.failureKind !== "permanent").length;
  const activityCount = queuedActivityCount + nativeShortcutCount;
  const timerStopCount = pendingTimerStopsForOwner(stops, owner)
    .filter((stop) => stop.failureKind !== "permanent").length;
  const reviewOwned = reviewOwner?.userId === owner.userId &&
    reviewOwner.workspaceId === owner.workspaceId;
  const locationOwned = locationOwner?.userId === owner.userId &&
    locationOwner.workspaceId === owner.workspaceId;
  const reviewCount = reviewOwned ? review.waitingCount : 0;
  const locationCount = locationOwned
    ? location.outboxCount + location.pendingEvidenceCount + nativeLocationSignalCount
    : 0;
  const nextRetryAt = earliestIso([
    activityDiagnostics.nextRetryAt,
    timeEntries.nextRetryAt ?? undefined,
    reviewOwned ? review.nextRetryAt ?? undefined : undefined
  ]);
  publish({
    accountKey: mobileAccountKey(owner),
    activityCount,
    nativeShortcutCount,
    timerStopCount,
    timeEntryCommandCount: timeEntries.pendingCount,
    timeEntryNeedsAttentionCount: timeEntries.needsAttentionCount,
    timeEntryQuarantinedCount: timeEntries.quarantinedCount,
    timeEntryDeviceQuarantinedCount: timeEntries.deviceQuarantinedCount,
    reviewCount,
    locationCount,
    nativeLocationSignalCount: locationOwned ? nativeLocationSignalCount : 0,
    pendingCount:
      activityCount + timerStopCount + timeEntries.pendingCount + reviewCount + locationCount,
    nextRetryAt: nextRetryAt ?? null,
    lastError: timeEntries.lastError ??
      (reviewOwned ? review.lastError : null) ??
      activityDiagnostics.firstFailed?.lastError ??
      null,
    revision: snapshot.revision + 1
  });
}

function publish(next: DurableWorkSnapshot) {
  if (snapshotsEqual(snapshot, next)) return;
  const previous = snapshot;
  snapshot = next;
  recordPendingTransition(previous, next);
  for (const listener of listeners) listener();
}

function snapshotsEqual(left: DurableWorkSnapshot, right: DurableWorkSnapshot) {
  return left.accountKey === right.accountKey &&
    left.activityCount === right.activityCount &&
    left.nativeShortcutCount === right.nativeShortcutCount &&
    left.timerStopCount === right.timerStopCount &&
    left.timeEntryCommandCount === right.timeEntryCommandCount &&
    left.timeEntryNeedsAttentionCount === right.timeEntryNeedsAttentionCount &&
    left.timeEntryQuarantinedCount === right.timeEntryQuarantinedCount &&
    left.timeEntryDeviceQuarantinedCount === right.timeEntryDeviceQuarantinedCount &&
    left.reviewCount === right.reviewCount &&
    left.locationCount === right.locationCount &&
    left.nativeLocationSignalCount === right.nativeLocationSignalCount &&
    left.pendingCount === right.pendingCount &&
    left.nextRetryAt === right.nextRetryAt &&
    left.lastError === right.lastError;
}

function earliestIso(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value && Number.isFinite(Date.parse(value))))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
}

function recordPendingTransition(
  previous: DurableWorkSnapshot,
  next: DurableWorkSnapshot
) {
  if (!((typeof __DEV__ !== "undefined" && __DEV__) || IS_DAYFRAME_STAGING)) return;
  console.debug("Durable work transition", {
    timestamp: new Date().toISOString(),
    accountChanged: previous.accountKey !== next.accountKey,
    previousPendingCount: previous.pendingCount,
    pendingCount: next.pendingCount,
    activityCount: next.activityCount,
    nativeShortcutCount: next.nativeShortcutCount,
    timerStopCount: next.timerStopCount,
    timeEntryCommandCount: next.timeEntryCommandCount,
    timeEntryNeedsAttentionCount: next.timeEntryNeedsAttentionCount,
    timeEntryQuarantinedCount: next.timeEntryQuarantinedCount,
    timeEntryDeviceQuarantinedCount: next.timeEntryDeviceQuarantinedCount,
    reviewCount: next.reviewCount,
    locationCount: next.locationCount,
    nativeLocationSignalCount: next.nativeLocationSignalCount,
    nextRetryAt: next.nextRetryAt
  });
}
