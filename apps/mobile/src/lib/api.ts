import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import {
  ActivityEventInputSchema,
  type ActivityEventInput,
  type ActivityEventType,
  type CategoryUsageRank,
  type EventSource,
  type HealthAutoLogMappings,
  type HealthImportPreferences,
  type LocationDisplayAddress,
  type LocationRolloutMode,
  type LocationReviewAction,
  type LocationReviewEvidenceDto,
  type RecentActivitySuggestion,
  type TimerStateFingerprint
} from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "./config";
import {
  MobileHttpResponseError,
  MobileRequestTimeoutError,
  StaleMobileSessionResponseError,
  isMobileTransportFailure,
  mobileFetch,
  mobileFetchWithTimeout
} from "./mobile-network";
import {
  bindAuthenticatedSessionOwner,
  clearSessionToken,
  getSessionToken,
  isAuthenticatedSessionSnapshotCurrent,
  readAuthenticatedSessionSnapshot,
  readOwnedAuthenticatedSessionSnapshot,
  setSessionToken
} from "./secure-session";
import {
  activateMobileAccount,
  deactivateMobileAccount,
  mobileAccountKey,
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
  type MobileAccountOwner
} from "./mobileAccount";
import {
  markPendingTimerStopFailure,
  removePendingTimerStop,
  timerStopOwnerMatches,
  type PendingTimerStop,
  type TimerStopOwner
} from "./timerStopOutbox";
import {
  endAllTimerBackgroundExecution,
  getTimerBackgroundExecutionSnapshot,
  reserveTimerBackgroundExecution,
  withTimerBackgroundExecutionReservation
} from "./timerBackgroundExecution";
import { isExplicitTimerMutationEventType } from "./timerMutationEvents";

const QUEUE_KEY = "dayframe.offlineQueue.v1";
const TIMER_ENTRY_ID_CORRELATIONS_KEY = "dayframe.timerEntryIdCorrelations.v1";
const DEFAULT_PLACE_RADIUS_METERS = 100;
const DEFAULT_PLACE_PRIORITY = 5;
const MOBILE_OPENING_REQUEST_TIMEOUT_MS = 15_000;
const MOBILE_QUEUE_REQUEST_TIMEOUT_MS = 15_000;
const MOBILE_TIMER_STOP_REQUEST_TIMEOUT_MS = 8_000;
export const MOBILE_TIME_ENTRY_REQUEST_TIMEOUT_MS = 8_000;
export const MOBILE_LOCATION_REVIEW_EVIDENCE_TIMEOUT_MS = 10_000;
export const MOBILE_LOCATION_REVIEW_ACTION_TIMEOUT_MS = 15_000;
let queueMutationTail: Promise<void> = Promise.resolve();
let timerEntryIdCorrelationMutationTail: Promise<void> = Promise.resolve();
type ActiveActivityQueueSync = {
  promise: Promise<SyncQueueResult>;
};
const activityQueueSyncInFlightByOwner = new Map<string, ActiveActivityQueueSync>();
const activityQueueListeners = new Set<() => void>();

export type MobileDateRange = {
  selectedDate: string;
  previousDate: string;
  nextDate: string;
  dayStart: string;
  dayEnd: string;
  weekStart: string;
  weekEnd: string;
};

export type MobileSeriesPoint = {
  key: string;
  label: string;
  seconds: number;
};

export type MobileStats = {
  todaySeconds: number;
  weekSeconds: number;
  todayCoveredSeconds?: number;
  weekCoveredSeconds?: number;
  todayAdditionalOverlapSeconds?: number;
  weekAdditionalOverlapSeconds?: number;
  reviewCount: number;
};

export type MobileTag = {
  id: string;
  name: string;
  normalizedName: string;
  usageCount?: number;
};

export type MobileTimeEntry = {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectColor: string | null;
  clientName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor?: string | null;
  placeName: string | null;
  placeKind?: "saved" | "one_time" | null;
  source: string;
  confidence: string;
  reviewStatus: string;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
  tagNames?: string[];
  tags?: MobileTag[];
};

export type MobileReviewItem = {
  id: string;
  type?: string;
  title: string;
  eventSource: string | null;
  eventType: string | null;
  categoryName: string | null;
  categoryColor?: string | null;
  placeName: string | null;
  suggestedCategoryId: string | null;
  suggestedPlaceId: string | null;
  suggestedStartedAt: string | null;
  suggestedStoppedAt: string | null;
  confidence: string;
  status: string;
  notes: string | null;
  rawPayload: Record<string, unknown> | null;
  createdAt: string;
};

export type MobileBootstrap = {
  user: {
    id: string;
    email: string;
    name: string;
    dailyGoalMinutes?: number;
    weeklyGoalMinutes?: number;
  };
  workspace: { id: string; name: string };
  locationRolloutMode?: LocationRolloutMode;
  dateRange?: MobileDateRange;
  activeEntry: MobileTimeEntry | null;
  stats?: MobileStats;
  todaySeries?: MobileSeriesPoint[];
  weekSeries?: MobileSeriesPoint[];
  projects: Array<{
    id: string;
    name: string;
    color: string;
    categoryId: string | null;
    categoryName: string | null;
    clientName: string | null;
  }>;
  categories: Array<{ id: string; name: string; color: string; isPinned: boolean }>;
  tags?: MobileTag[];
  entries: MobileTimeEntry[];
  historyEntries?: MobileTimeEntry[];
  dayEntries?: MobileTimeEntry[];
  weekEntries?: MobileTimeEntry[];
  places: Array<{
    id: string;
    name: string;
    latitude?: number | null;
    longitude?: number | null;
    radiusMeters: number;
    priority: number;
    defaultProjectId: string | null;
    defaultProjectName?: string | null;
    defaultCategoryId: string | null;
    defaultCategoryName?: string | null;
    defaultActivityDescription?: string | null;
    autoStart?: boolean;
    loggingEnabled?: boolean;
  }>;
  learnedPlaces?: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    visitCount: number;
    distinctDayCount: number;
    sampleCount: number;
    totalDwellSeconds: number;
    longestDwellSeconds: number;
    averageAccuracyMeters: number | null;
    maxClusterSpreadMeters: number | null;
    firstSeenAt: string;
    lastSeenAt: string;
    lastStartedAt: string | null;
    lastStoppedAt: string | null;
    confidence: string;
    classification: "place_candidate" | "one_off_activity" | "noise";
    status: "candidate" | "accepted" | "ignored";
    address: Record<string, unknown> | null;
    poiName: string | null;
    formattedAddress: string | null;
    geocodedAt: string | null;
    rawPayload: Record<string, unknown> | null;
  }>;
  reviewItems: MobileReviewItem[];
  categoryUsage?: CategoryUsageRank[];
  taskSuggestions?: RecentActivitySuggestion[];
};

export type MobileCategoryResponse = {
  ok: true;
  category: MobileBootstrap["categories"][number];
};

export type MobileTagResponse = {
  ok: true;
  tag: MobileTag;
};

export type MobilePlace = MobileBootstrap["places"][number];
export type MobileLearnedPlace = NonNullable<MobileBootstrap["learnedPlaces"]>[number];

export type MobilePlaceResponse = {
  ok: true;
  place: MobilePlace;
};

export type PlaceMutationInput = {
  learnedPlaceId?: string;
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number;
  priority?: number;
  defaultCategoryId?: string | null;
  defaultActivityDescription?: string | null;
  loggingEnabled?: boolean;
};

export type TimeEntryUpdatePatch = {
  categoryId?: string | null;
  description?: string | null;
  startedAt?: string;
  stoppedAt?: string | null;
  tagNames?: string[];
};

export type ManualTimeEntryInput = {
  categoryId?: string | null;
  description?: string | null;
  startedAt: string;
  stoppedAt: string;
  tagNames?: string[];
};

export type TimerActionResult = {
  eventId?: string;
  timeEntryId?: string;
};

export type PendingTimerStopDeliveryResult =
  | { status: "delivered"; pendingStop: PendingTimerStop }
  | { status: "waiting_for_canonical_target"; pendingStop: PendingTimerStop }
  | { status: "account_mismatch"; pendingStop: PendingTimerStop }
  | { status: "session_changed"; pendingStop: PendingTimerStop }
  | { status: "retryable_failure"; pendingStop: PendingTimerStop; error: Error }
  | { status: "permanent_failure"; pendingStop: PendingTimerStop; error: Error };

export type ReviewItemAction = "accept" | "ignore_once";

export type HealthReviewReprocessResult = {
  ok: boolean;
  checkedCount: number;
  confirmedCount: number;
  ignoredCount: number;
  leftInReviewCount: number;
  skippedCount: number;
  failedCount: number;
  updatedCategoryCount: number;
  repairedSleepEntryCount: number;
  remainingReviewCount: number;
  batchSize?: number;
  partial?: boolean;
  hasMore?: boolean;
  errorSummary: string[];
  reasons?: Array<{
    reviewItemId: string;
    code: string;
    message: string;
    blockingEntry?: {
      id: string;
      description: string | null;
      source: string;
      reviewStatus: string;
      startedAt: string;
      stoppedAt: string | null;
      categoryName: string | null;
      stoppedAtIsNull: boolean;
    };
  }>;
};

export type MobileAuthSession = {
  token: string;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
  expiresAt: string;
};

export type MobileAuthConfirmation = {
  requiresEmailConfirmation: true;
  message: string;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
};

export type MobileAuthResult = MobileAuthSession | MobileAuthConfirmation;

export type QueuedEvent = Omit<ActivityEventInput, "occurredAt" | "workspaceId" | "userId" | "clientEventId"> & {
  occurredAt: Date;
  localId: string;
  queuedAt: string;
  userId: string;
  workspaceId: string;
  failedAt?: string;
  failureCount?: number;
  lastError?: string;
  lastStatusCode?: number;
  lastAttemptedAt?: string;
  nextRetryAt?: string;
  failureKind?: QueueFailureKind;
};

export type QueueFailureKind = "network" | "server" | "permanent";

export type QueueFailureReport = {
  localId: string;
  source: string;
  type: string;
  occurredAt: string;
  message: string;
  statusCode?: number;
  failureKind: QueueFailureKind;
};

export type SyncQueueResult = {
  synced: string[];
  timerEntryIdCorrelations: TimerEntryIdCorrelation[];
  remaining: QueuedEvent[];
  failed: QueuedEvent[];
  syncedCount: number;
  remainingCount: number;
  failedCount: number;
  firstError?: QueueFailureReport;
  stopped: boolean;
};

export type TimerEntryIdCorrelation = {
  localId: string;
  timeEntryId: string;
};

export type QueueDiagnostics = {
  queuedCount: number;
  failedCount: number;
  retryableFailedCount: number;
  permanentFailedCount: number;
  clearableFailedCount: number;
  oldestQueuedAt?: string;
  nextRetryAt?: string;
  lastAttemptedAt?: string;
  firstFailed?: QueuedEvent;
};

export type QueueDiagnosticsSnapshot = {
  exportedAt: string;
  diagnostics: QueueDiagnostics;
  lastSyncResult?: {
    syncedCount: number;
    remainingCount: number;
    failedCount: number;
    stopped: boolean;
    firstError?: QueueFailureReport;
  };
  queue: Array<Omit<QueuedEvent, "occurredAt"> & { occurredAt: string }>;
};

export type SyncQueueOptions = {
  retryFailed?: boolean;
  onlyFailed?: boolean;
  forceRetry?: boolean;
  signal?: AbortSignal;
  eventScope?: "all" | "timer_mutations" | "non_timer";
};

type StoredQueuedEvent = Partial<Omit<QueuedEvent, "occurredAt">> & {
  occurredAt?: string | Date;
  workspaceId?: unknown;
  userId?: unknown;
  clientEventId?: unknown;
};

type QueueableEvent = Omit<
  QueuedEvent,
  | "localId"
  | "queuedAt"
  | "failedAt"
  | "failureCount"
  | "lastError"
  | "lastStatusCode"
  | "lastAttemptedAt"
  | "nextRetryAt"
  | "failureKind"
  | "userId"
  | "workspaceId"
>;

type ActivityEventDraft = {
  source: EventSource;
  type: ActivityEventType;
  occurredAt?: Date;
  localId?: string;
  deviceId?: string;
  projectId?: string;
  categoryId?: string;
  placeId?: string;
  description?: string;
  rawPayload?: Record<string, unknown>;
  owner?: MobileAccountOwner;
  requestImmediateDelivery?: boolean;
};

type ApiErrorPayload = {
  code?: string;
  error?: string;
  message?: string;
  blockingEntry?: {
    description?: string | null;
    source?: string;
    reviewStatus?: string;
    startedAt?: string;
    stoppedAt?: string | null;
  };
  issues?: Array<{ path?: Array<string | number>; message?: string }>;
};

type ApiJsonRead<T> =
  | { ok: true; payload: T }
  | { ok: false; message: string };

export async function fetchBootstrap(options: { date?: string } = {}): Promise<MobileBootstrap> {
  const params = options.date ? `?date=${encodeURIComponent(options.date)}` : "";
  const sessionRead = await readAuthenticatedSessionSnapshot();
  if (sessionRead.status === "changed") {
    throw new StaleMobileSessionResponseError();
  }
  const response = await mobileFetchWithTimeout(
    `${DAYFRAME_API_BASE}/api/bootstrap${params}`,
    {
      headers: sessionRead.status === "authenticated"
        ? { Authorization: `Bearer ${sessionRead.snapshot.token}` }
        : {}
    },
    {
      timeoutMilliseconds: MOBILE_OPENING_REQUEST_TIMEOUT_MS,
      timeoutMessage: "Dayframe is taking too long to open. Check your connection and try again."
    }
  );
  if (response.status === 401) {
    const reviewStore = await reviewSyncStore();
    if (reviewStore) await reviewStore.synchroniseReviewMutations();
    throw new AuthRequiredError();
  }
  if (
    sessionRead.status === "authenticated" &&
    !isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot)
  ) {
    throw new StaleMobileSessionResponseError();
  }
  if (!response.ok) {
    throw new MobileHttpResponseError(
      response.status,
      await errorMessage(response, "Unable to load Dayframe API")
    );
  }
  const bootstrap = await readJsonResponse<MobileBootstrap>(response);
  if (bootstrap.user?.id && bootstrap.workspace?.id) {
    const owner = {
      userId: bootstrap.user.id,
      workspaceId: bootstrap.workspace.id
    };
    if (sessionRead.status === "authenticated") {
      if (
        sessionRead.snapshot.owner &&
        !mobileAccountOwnersEqual(sessionRead.snapshot.owner, owner)
      ) {
        throw new StaleMobileSessionResponseError();
      }
      if (!await bindAuthenticatedSessionOwner(sessionRead.snapshot, owner)) {
        throw new StaleMobileSessionResponseError();
      }
    }
    await activateMobileAccount(owner);
  }
  const reviewStore = await reviewSyncStore();
  if (!reviewStore) return bootstrap;
  const projected = await reviewStore.processReviewBootstrap(bootstrap);
  void reviewStore.synchroniseReviewMutations().catch(() => undefined);
  return projected;
}

export async function fetchTimerState(): Promise<TimerStateFingerprint> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/timer-state`, {
    headers: await authHeaders(),
    cache: "no-store"
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Unable to check timer state"));
  }
  return readJsonResponse<TimerStateFingerprint>(response);
}

export async function registerLiveActivity(input: {
  token: string;
  activityId: string;
  activeEntryId: string;
  environment: "development" | "production";
}) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/live-activities`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...await authHeaders()
    },
    body: JSON.stringify(input)
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Unable to register Live Activity"));
  }
}

export async function login(email: string, password: string) {
  return authenticate("/api/auth/login", { email, password });
}

export async function signup(email: string, password: string, name?: string, workspaceName?: string) {
  return authenticate("/api/auth/signup", { email, password, name, workspaceName });
}

export async function logout() {
  // Abort request signals before the first awaited logout operation. Native
  // task cleanup continues asynchronously, but queued mutations remain owned
  // by the account until the normal durable-work cleanup boundary runs.
  void endAllTimerBackgroundExecution("logout");
  const activeOwner = await readActiveMobileAccount();
  const token = await getSessionToken();
  await mobileFetch(`${DAYFRAME_API_BASE}/api/auth/logout`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  }).catch(() => undefined);
  await import("./location/runtime")
    .then(async ({ clearNativeLocationSignals, stopNativeLocationIntelligence }) => {
      await stopNativeLocationIntelligence();
      await clearNativeLocationSignals();
    })
    .catch(() => undefined);
  await import("./location/store")
    .then(({ clearActiveLocationAccountData }) => clearActiveLocationAccountData())
    .catch(() => undefined);
  await import("./reviewSyncStore")
    .then(({ clearActiveReviewAccountData }) => clearActiveReviewAccountData())
    .catch(() => undefined);
  await import("./shortcuts")
    .then(async ({ clearActiveOwnerNativeShortcutQueue, clearShortcutCatalog }) => {
      if (activeOwner) {
        await clearActiveOwnerNativeShortcutQueue(activeOwner).catch(() => 0);
      }
      clearShortcutCatalog();
    })
    .catch(() => undefined);
  await clearSessionToken();
  await deactivateMobileAccount();
}

export { clearSessionToken, getSessionToken };

export async function enqueueEvent(input: ActivityEventDraft) {
  return withQueueMutation(async () => {
    const activeOwner = await readActiveMobileAccount();
    const owner = input.owner ?? activeOwner;
    if (!owner || !mobileAccountOwnersEqual(activeOwner, owner)) {
      throw new Error("An authenticated account is required to queue activity.");
    }
    const {
      localId,
      owner: _owner,
      requestImmediateDelivery,
      ...eventInput
    } = input;
    const parsed = ActivityEventInputSchema.parse({
      ...eventInput,
      occurredAt: input.occurredAt ?? new Date(),
      rawPayload: eventInput.rawPayload ?? {}
    });
    const all = await readAllQueue(owner);
    const queue = all.filter((item) => mobileAccountOwnersEqual(item, owner));
    const queuedLocalId = normalizeLocalId(localId) ?? generatedLocalId();
    if (queue.some((item) => item.localId === queuedLocalId)) {
      if (requestImmediateDelivery && isExplicitTimerMutationEventType(parsed.type)) {
        await reserveTimerBackgroundExecution(
          activityQueueBackgroundExecutionKey(owner),
          "Dayframe timer Start sync"
        );
      }
      return queue;
    }
    const nextItem: QueuedEvent = {
      ...queuedEventFromParsedEvent(parsed),
      localId: queuedLocalId,
      queuedAt: new Date().toISOString(),
      userId: owner.userId,
      workspaceId: owner.workspaceId
    };
    await writeAllQueue([...all, nextItem]);
    if (requestImmediateDelivery && isExplicitTimerMutationEventType(nextItem.type)) {
      await reserveTimerBackgroundExecution(
        activityQueueBackgroundExecutionKey(owner),
        "Dayframe timer Start sync"
      );
    }
    return [...queue, nextItem];
  });
}

export async function readQueue(owner?: MobileAccountOwner): Promise<QueuedEvent[]> {
  const resolvedOwner = owner ?? await readActiveMobileAccount();
  if (!resolvedOwner) return [];
  return (await readAllQueue(resolvedOwner))
    .filter((item) => mobileAccountOwnersEqual(item, resolvedOwner));
}

export async function readTimerEntryIdCorrelations(owner?: MobileAccountOwner) {
  const resolvedOwner = owner ?? await readActiveMobileAccount();
  if (!resolvedOwner) return new Map<string, string>();
  const records = await readAllTimerEntryIdCorrelations(resolvedOwner);
  return new Map(
    records
      .filter((record) => mobileAccountOwnersEqual(record, resolvedOwner))
      .map((record) => [record.localId, record.timeEntryId])
  );
}

export async function recordTimerEntryIdCorrelation(
  localId: string,
  timeEntryId: string,
  owner?: MobileAccountOwner
) {
  if (!localId || !timeEntryId) return false;
  return withTimerEntryIdCorrelationMutation(async () => {
    const resolvedOwner = owner ?? await readActiveMobileAccount();
    if (!resolvedOwner) return false;
    const records = await readAllTimerEntryIdCorrelations(resolvedOwner);
    const next = records.filter((record) =>
      !mobileAccountOwnersEqual(record, resolvedOwner) || record.localId !== localId
    );
    next.push({ ...resolvedOwner, localId, timeEntryId });
    await AsyncStorage.setItem(
      TIMER_ENTRY_ID_CORRELATIONS_KEY,
      JSON.stringify(next)
    );
    return true;
  });
}

export async function removeTimerEntryIdCorrelation(
  localId: string,
  owner?: MobileAccountOwner
) {
  return withTimerEntryIdCorrelationMutation(async () => {
    const resolvedOwner = owner ?? await readActiveMobileAccount();
    if (!resolvedOwner) return false;
    const records = await readAllTimerEntryIdCorrelations(resolvedOwner);
    const next = records.filter((record) =>
      !mobileAccountOwnersEqual(record, resolvedOwner) || record.localId !== localId
    );
    if (next.length === records.length) return false;
    await AsyncStorage.setItem(
      TIMER_ENTRY_ID_CORRELATIONS_KEY,
      JSON.stringify(next)
    );
    return true;
  });
}

/**
 * Waits behind any queue sync that may be turning a local timer-start ID into
 * a canonical entry ID, then reads that durable correlation under its own
 * storage lock. Callers can safely choose between canonical persistence and a
 * still-queued local mutation after this resolves.
 */
export async function resolveTimerEntryIdAfterQueueBarrier(localId: string) {
  if (!localId) return null;
  const { pendingSync } = await withQueueMutation(async () => {
    const owner = await readActiveMobileAccount();
    return {
      pendingSync: owner
        ? activityQueueSyncInFlightByOwner.get(mobileAccountKey(owner))?.promise ?? null
        : null
    };
  });
  await pendingSync?.catch(() => undefined);
  return withTimerEntryIdCorrelationMutation(async () => {
    const correlations = await readTimerEntryIdCorrelations();
    return correlations.get(localId) ?? null;
  });
}

export async function updateQueuedTimerStart(
  localId: string,
  patch: Pick<TimeEntryUpdatePatch, "categoryId" | "description" | "startedAt" | "tagNames">
) {
  return withQueueMutation(async () => {
    const owner = await readActiveMobileAccount();
    if (!owner) return false;
    const all = await readAllQueue(owner);
    let updated = false;
    const next = all.map((item) => {
      if (
        !mobileAccountOwnersEqual(item, owner) ||
        item.localId !== localId ||
        item.type !== "timer_start"
      ) return item;
      updated = true;
      return {
        ...item,
        categoryId: Object.prototype.hasOwnProperty.call(patch, "categoryId")
          ? patch.categoryId ?? undefined
          : item.categoryId,
        description: Object.prototype.hasOwnProperty.call(patch, "description")
          ? patch.description?.trim() || undefined
          : item.description,
        occurredAt: patch.startedAt ? new Date(patch.startedAt) : item.occurredAt,
        rawPayload: {
          ...item.rawPayload,
          ...(patch.startedAt ? { startedAt: patch.startedAt } : {}),
          ...(Object.prototype.hasOwnProperty.call(patch, "tagNames")
            ? { tagNames: patch.tagNames ?? [] }
            : {})
        }
      };
    });
    if (updated) await writeAllQueue(next);
    return updated;
  });
}

export async function removeQueuedEvent(localId: string) {
  return withQueueMutation(async () => {
    const owner = await readActiveMobileAccount();
    if (!owner) return false;
    const all = await readAllQueue(owner);
    const next = all.filter((item) =>
      !mobileAccountOwnersEqual(item, owner) || item.localId !== localId
    );
    if (next.length !== all.length) await writeAllQueue(next);
    return next.length !== all.length;
  });
}

export function subscribeActivityQueue(listener: () => void) {
  activityQueueListeners.add(listener);
  return () => activityQueueListeners.delete(listener);
}

export function getQueueDiagnostics(queue: QueuedEvent[]): QueueDiagnostics {
  const failed = queue.filter(hasQueueFailure);
  const retryableFailed = failed.filter((item) => !isPermanentlyFailedEvent(item));
  const permanentFailed = failed.filter(isPermanentlyFailedEvent);
  return {
    queuedCount: queue.length,
    failedCount: failed.length,
    retryableFailedCount: retryableFailed.length,
    permanentFailedCount: permanentFailed.length,
    clearableFailedCount: queue.filter(isClearableFailedEvent).length,
    oldestQueuedAt: earliestIso(queue.map((item) => item.queuedAt)),
    nextRetryAt: earliestIso(retryableFailed.map((item) => item.nextRetryAt)),
    lastAttemptedAt: latestIso(queue.map((item) => item.lastAttemptedAt)),
    firstFailed: failed[0]
  };
}

export function buildQueueDiagnosticsSnapshot(
  queue: QueuedEvent[],
  lastSyncResult?: SyncQueueResult | null
): QueueDiagnosticsSnapshot {
  return {
    exportedAt: new Date().toISOString(),
    diagnostics: getQueueDiagnostics(queue),
    lastSyncResult: lastSyncResult
      ? {
          syncedCount: lastSyncResult.syncedCount,
          remainingCount: lastSyncResult.remainingCount,
          failedCount: lastSyncResult.failedCount,
          stopped: lastSyncResult.stopped,
          firstError: lastSyncResult.firstError
        }
      : undefined,
    queue: queue.map((item) => ({
      ...item,
      occurredAt: item.occurredAt.toISOString()
    }))
  };
}

export async function retryFailedQueuedEvents() {
  return syncQueue({ retryFailed: true, onlyFailed: true, forceRetry: true });
}

export async function clearFailedQueuedEvents() {
  return withQueueMutation(async () => {
    const owner = await readActiveMobileAccount();
    if (!owner) {
      return { removed: [], remaining: [], removedCount: 0, remainingCount: 0 };
    }
    const all = await readAllQueue(owner);
    const queue = all.filter((item) => mobileAccountOwnersEqual(item, owner));
    const remaining = queue.filter((item) => !isClearableFailedEvent(item));
    const removed = queue.filter(isClearableFailedEvent);
    await writeAllQueue([
      ...all.filter((item) => !mobileAccountOwnersEqual(item, owner)),
      ...remaining
    ]);
    return {
      removed,
      remaining,
      removedCount: removed.length,
      remainingCount: remaining.length
    };
  });
}

export async function syncQueue(options: SyncQueueOptions = {}): Promise<SyncQueueResult> {
  const { sync } = await withQueueMutation(async () => {
    const owner = await readActiveMobileAccount();
    if (!owner) {
      return { sync: Promise.resolve(queueSyncResult([], [], undefined, false)) };
    }
    const ownerKey = mobileAccountKey(owner);
    const previous = activityQueueSyncInFlightByOwner.get(ownerKey)?.promise;
    const active: ActiveActivityQueueSync = { promise: Promise.resolve(
      queueSyncResult([], [], undefined, false)
    ) };
    const nextSync = (previous?.catch(() => undefined) ?? Promise.resolve())
      .then(() => runActivityQueueSyncRequest(options, owner))
      .finally(() => {
        if (activityQueueSyncInFlightByOwner.get(ownerKey) === active) {
          activityQueueSyncInFlightByOwner.delete(ownerKey);
        }
      });
    active.promise = nextSync;
    activityQueueSyncInFlightByOwner.set(ownerKey, active);
    return { sync: nextSync };
  });
  return sync;
}

async function runActivityQueueSyncRequest(
  options: SyncQueueOptions,
  owner: MobileAccountOwner
) {
  if (options.eventScope === "timer_mutations") {
    return syncQueueUnlocked(options, owner);
  }
  if (options.eventScope === "non_timer") {
    if (
      getTimerBackgroundExecutionSnapshot().activeLeaseCount > 0 ||
      !foregroundActivitySyncAllowed()
    ) {
      return deferredQueueSyncResult(owner, "non_timer");
    }
    return syncQueueUnlocked({ ...options, signal: undefined }, owner);
  }

  const timerResult = await syncQueueUnlocked({
    ...options,
    eventScope: "timer_mutations"
  }, owner);
  if (
    options.signal?.aborted ||
    timerResult.stopped
  ) {
    return combineQueueSyncResults(
      [timerResult],
      await ownedQueueForScope(owner, "all"),
      options.signal?.aborted === true
    );
  }
  if (
    getTimerBackgroundExecutionSnapshot().activeLeaseCount > 0 ||
    !foregroundActivitySyncAllowed()
  ) {
    return combineQueueSyncResults(
      [timerResult],
      await ownedQueueForScope(owner, "all"),
      true
    );
  }
  const foregroundResult = await syncQueueUnlocked({
    ...options,
    eventScope: "non_timer",
    signal: undefined
  }, owner);
  return combineQueueSyncResults(
    [timerResult, foregroundResult],
    await ownedQueueForScope(owner, "all")
  );
}

async function deferredQueueSyncResult(
  owner: MobileAccountOwner,
  scope: NonNullable<SyncQueueOptions["eventScope"]>
) {
  return combineQueueSyncResults(
    [],
    await ownedQueueForScope(owner, scope),
    true
  );
}

async function ownedQueueForScope(
  owner: MobileAccountOwner,
  scope: NonNullable<SyncQueueOptions["eventScope"]>
) {
  const all = await withQueueMutation(() => readAllQueue(owner));
  return all.filter((item) =>
    mobileAccountOwnersEqual(item, owner) && queueEventMatchesScope(item, scope)
  );
}

function foregroundActivitySyncAllowed() {
  return !AppState?.currentState || AppState.currentState === "active";
}

function combineQueueSyncResults(
  results: readonly SyncQueueResult[],
  remaining: QueuedEvent[],
  forceStopped = false
): SyncQueueResult {
  const synced = [...new Set(results.flatMap((result) => result.synced))];
  const correlations = new Map<string, string>();
  for (const result of results) {
    for (const correlation of result.timerEntryIdCorrelations) {
      correlations.set(correlation.localId, correlation.timeEntryId);
    }
  }
  const firstError = results.find((result) => result.firstError)?.firstError;
  return queueSyncResult(
    synced,
    remaining,
    firstError,
    forceStopped || results.some((result) => result.stopped),
    [...correlations].map(([localId, timeEntryId]) => ({ localId, timeEntryId }))
  );
}

async function syncQueueUnlocked(
  options: SyncQueueOptions,
  owner: MobileAccountOwner
): Promise<SyncQueueResult> {
  const all = await withQueueMutation(() => readAllQueue(owner));
  const queue = all.filter((item) =>
    mobileAccountOwnersEqual(item, owner) && queueEventMatchesScope(item, options.eventScope)
  );
  const hasDeliverableTimerMutation = queue.some((item) =>
    isQueuedTimerMutationEvent(item) && item.failureKind !== "permanent"
  );
  if (options.eventScope !== "non_timer") {
    return withTimerBackgroundExecutionReservation(
      activityQueueBackgroundExecutionKey(owner),
      "Dayframe timer Start sync",
      (reservedSignal) => syncQueueItems(
        queue,
        { ...options, signal: options.signal ?? reservedSignal },
        owner
      ),
      { beginIfMissing: !options.signal && hasDeliverableTimerMutation }
    );
  }
  return syncQueueItems(queue, options, owner);
}

function activityQueueBackgroundExecutionKey(owner: MobileAccountOwner) {
  return `activity_queue:${mobileAccountKey(owner)}`;
}

async function syncQueueItems(
  queue: QueuedEvent[],
  options: SyncQueueOptions,
  owner: MobileAccountOwner
): Promise<SyncQueueResult> {
  const remaining: QueuedEvent[] = [];
  const synced: string[] = [];
  const timerEntryIdCorrelations: TimerEntryIdCorrelation[] = [];
  let firstError: QueueFailureReport | undefined;
  let stopped = false;
  const now = new Date();

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (options.signal?.aborted) {
      remaining.push(item, ...queue.slice(index + 1));
      stopped = true;
      break;
    }
    if (options.onlyFailed && !hasQueueFailure(item)) {
      remaining.push(item);
      continue;
    }
    if (!options.retryFailed && isPermanentlyFailedEvent(item)) {
      remaining.push(item);
      firstError ??= queueFailureReport(
        item,
        item.lastError ?? "Queued event is marked invalid.",
        item.failureKind ?? "permanent",
        item.lastStatusCode
      );
      continue;
    }
    if (hasQueueFailure(item) && !options.retryFailed && !options.forceRetry && !isQueueRetryDue(item, now)) {
      remaining.push(item, ...queue.slice(index + 1));
      firstError ??= queueFailureReport(
        item,
        `Next retry ${formatRetryIso(item.nextRetryAt)}.`,
        item.failureKind ?? "network",
        item.lastStatusCode
      );
      stopped = true;
      break;
    }

    const attemptedAt = new Date().toISOString();
    try {
      const sessionRead = await readOwnedAuthenticatedSessionSnapshot(owner);
      if (sessionRead.status !== "authenticated") {
        remaining.push(item, ...queue.slice(index + 1));
        stopped = true;
        break;
      }
      const response = await mobileFetchWithTimeout(
        `${DAYFRAME_API_BASE}/api/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionRead.snapshot.token}`
          },
          body: JSON.stringify(queuedEventRequestBody(item)),
          signal: options.signal
        },
        {
          timeoutMilliseconds: MOBILE_QUEUE_REQUEST_TIMEOUT_MS,
          timeoutMessage: "Queued activity sync timed out. It will retry automatically."
        }
      );
      if (response.status === 401 || response.status === 403) {
        throw new AuthRequiredError();
      }
      if (
        !isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot) ||
        !mobileAccountOwnersEqual(await readActiveMobileAccount(), owner)
      ) {
        remaining.push(item, ...queue.slice(index + 1));
        stopped = true;
        break;
      }
      if (!response.ok) {
        const failureKind = permanentStatusCodes.has(response.status) ? "permanent" : "server";
        const message = await errorMessage(response, "Unable to sync queued event");
        const failedItem = markQueueFailure(item, message, attemptedAt, failureKind, response.status);
        remaining.push(failedItem);
        firstError ??= queueFailureReport(failedItem, message, failureKind, response.status);
        if (failureKind !== "permanent") {
          remaining.push(...queue.slice(index + 1));
          stopped = true;
          break;
        }
        continue;
      }
      const payload = await readJsonResponse<{ eventId?: string; timeEntryId?: string }>(response);
      if (item.type === "timer_start") {
        if (!payload.timeEntryId) {
          throw new Error("Synced timer start did not return its canonical time entry.");
        }
        await recordTimerEntryIdCorrelation(item.localId, payload.timeEntryId, owner);
        timerEntryIdCorrelations.push({
          localId: item.localId,
          timeEntryId: payload.timeEntryId
        });
      }
      synced.push(item.localId);
    } catch (error) {
      if (error instanceof AuthRequiredError) throw error;
      const message = error instanceof Error ? error.message : "Network request failed";
      const failedItem = markQueueFailure(item, message, attemptedAt, "network");
      remaining.push(failedItem, ...queue.slice(index + 1));
      firstError ??= queueFailureReport(failedItem, message, "network");
      stopped = true;
      break;
    }
  }

  const reconciledRemaining = await reconcileActivityQueueDrain({
    owner,
    processed: queue,
    remaining,
    synced
  });
  return queueSyncResult(
    synced,
    reconciledRemaining.filter((item) => queueEventMatchesScope(item, options.eventScope)),
    firstError,
    stopped,
    timerEntryIdCorrelations
  );
}

function queueEventMatchesScope(
  event: Pick<QueuedEvent, "type">,
  scope: SyncQueueOptions["eventScope"] = "all"
) {
  if (scope === "timer_mutations") return isQueuedTimerMutationEvent(event);
  if (scope === "non_timer") return !isQueuedTimerMutationEvent(event);
  return true;
}

export function isQueuedTimerMutationEvent(event: Pick<QueuedEvent, "type">) {
  return isExplicitTimerMutationEventType(event.type);
}

export async function startTimer(
  categoryId?: string | null,
  description?: string,
  startedAt?: string,
  tagNames?: string[]
) {
  const trimmedDescription = description?.trim();
  return postTimerAction({
    mode: "start",
    source: "mobile_app",
    categoryId: categoryId ?? undefined,
    description: trimmedDescription || undefined,
    startedAt,
    ...(tagNames ? { tagNames } : {})
  });
}

export async function stopTimer() {
  return postTimerAction({
    mode: "stop",
    source: "mobile_app"
  });
}

export async function deliverPendingTimerStop(
  pendingStop: PendingTimerStop,
  owner: TimerStopOwner,
  signal?: AbortSignal
): Promise<PendingTimerStopDeliveryResult> {
  if (!timerStopOwnerMatches(pendingStop, owner)) {
    return { status: "account_mismatch", pendingStop };
  }
  if (!pendingStop.targetEntryId) {
    return { status: "waiting_for_canonical_target", pendingStop };
  }
  if (!mobileAccountOwnersEqual(await readActiveMobileAccount(), owner)) {
    return { status: "session_changed", pendingStop };
  }

  const sessionRead = await readOwnedAuthenticatedSessionSnapshot(owner);
  if (sessionRead.status === "changed" || sessionRead.status === "owner_mismatch") {
    return { status: "session_changed", pendingStop };
  }
  if (sessionRead.status === "signed_out") {
    throw new AuthRequiredError();
  }
  if (!isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot)) {
    return { status: "session_changed", pendingStop };
  }

  try {
    const response = await mobileFetchWithTimeout(
      `${DAYFRAME_API_BASE}/api/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionRead.snapshot.token}`
        },
        body: JSON.stringify({
          source: "mobile_app",
          type: "timer_stop",
          occurredAt: pendingStop.occurredAt,
          clientEventId: pendingStop.clientEventId,
          rawPayload: {
            origin: "mobile_timer_stop",
            stopScope: "entry",
            targetEntryId: pendingStop.targetEntryId
          }
        }),
        signal
      },
      {
        timeoutMilliseconds: MOBILE_TIMER_STOP_REQUEST_TIMEOUT_MS,
        timeoutMessage: "Timer Stop is still pending. Dayframe will retry automatically."
      }
    );
    if (response.status === 401 || response.status === 403) {
      throw new AuthRequiredError();
    }
    if (
      !isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot) ||
      !mobileAccountOwnersEqual(await readActiveMobileAccount(), owner)
    ) {
      return { status: "session_changed", pendingStop };
    }
    if (response.ok) {
      await removePendingTimerStop(pendingStop.clientEventId);
      return { status: "delivered", pendingStop };
    }

    const message = await errorMessage(response, "Unable to sync timer Stop");
    const failureKind = permanentStatusCodes.has(response.status) ? "permanent" : "retryable";
    const updated = await markPendingTimerStopFailure(pendingStop.clientEventId, {
      message,
      failureKind,
      statusCode: response.status
    });
    const failedStop = updated ?? pendingStop;
    const error = new Error(message);
    return failureKind === "permanent"
      ? { status: "permanent_failure", pendingStop: failedStop, error }
      : { status: "retryable_failure", pendingStop: failedStop, error };
  } catch (error) {
    if (error instanceof AuthRequiredError) throw error;
    const failure = error instanceof Error ? error : new Error("Network request failed");
    const updated = await markPendingTimerStopFailure(pendingStop.clientEventId, {
      message: failure.message,
      failureKind: "retryable"
    });
    return {
      status: "retryable_failure",
      pendingStop: updated ?? pendingStop,
      error: failure
    };
  }
}

export async function deleteTimeEntry(id: string) {
  const response = await mobileFetchWithTimeout(
    `${DAYFRAME_API_BASE}/api/time-entries/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: await authHeaders()
    },
    {
      timeoutMilliseconds: MOBILE_TIME_ENTRY_REQUEST_TIMEOUT_MS,
      timeoutMessage: "This deletion is taking too long. It can be retried safely."
    }
  );
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to delete timer"));
  return readJsonResponse(response);
}

export async function updateTimeEntry(id: string, patch: TimeEntryUpdatePatch) {
  const response = await mobileFetchWithTimeout(
    `${DAYFRAME_API_BASE}/api/time-entries/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders())
      },
      body: JSON.stringify(patch)
    },
    {
      timeoutMilliseconds: MOBILE_TIME_ENTRY_REQUEST_TIMEOUT_MS,
      timeoutMessage: "This edit is taking too long. It can be retried safely."
    }
  );
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update timer"));
  return readJsonResponse(response);
}

export async function createManualTimeEntry(input: ManualTimeEntryInput) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/time-entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({
      mode: "manual",
      categoryId: input.categoryId ?? null,
      description: input.description?.trim() || null,
      ...(input.tagNames ? { tagNames: input.tagNames } : {}),
      startedAt: input.startedAt,
      stoppedAt: input.stoppedAt
    })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to create time entry"));
  return readJsonResponse(response);
}

export async function resolveReviewItem(id: string, action: ReviewItemAction) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/review/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ action })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (response.status === 409) {
    const result = await readApiJson<ApiErrorPayload>(response, "Unable to update review item");
    if (result.ok && result.payload.code === "already_resolved") {
      return {
        ok: true,
        alreadyResolved: true,
        status: "accepted"
      };
    }
    throw new Error(result.ok ? formatApiError(result.payload) ?? "Unable to update review item" : result.message);
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update review item"));
  return readJsonResponse(response);
}

export async function resolveLocationReviewItem(id: string, action: LocationReviewAction) {
  const response = await mobileFetchWithTimeout(
    `${DAYFRAME_API_BASE}/api/review/${encodeURIComponent(id)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders())
      },
      body: JSON.stringify(action)
    },
    {
      timeoutMilliseconds: MOBILE_LOCATION_REVIEW_ACTION_TIMEOUT_MS,
      timeoutMessage: "This location Review action is taking too long. Your changes are still here."
    }
  );
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update location review"));
  return readJsonResponse(response);
}

export async function fetchLocationReviewEvidence(
  id: string,
  options: { signal?: AbortSignal } = {}
): Promise<LocationReviewEvidenceDto> {
  const response = await mobileFetchWithTimeout(
    `${DAYFRAME_API_BASE}/api/review/${encodeURIComponent(id)}/location-evidence`,
    {
      headers: await authHeaders(),
      cache: "no-store",
      signal: options.signal
    },
    {
      timeoutMilliseconds: MOBILE_LOCATION_REVIEW_EVIDENCE_TIMEOUT_MS,
      timeoutMessage: "Location evidence is taking too long to load."
    }
  );
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to load location evidence"));
  return readJsonResponse<LocationReviewEvidenceDto>(response);
}

export function normaliseLocationReviewRequestError(
  error: unknown,
  kind: "evidence" | "action"
) {
  if (error instanceof MobileRequestTimeoutError) return error.message;
  const message = error instanceof Error ? error.message : "";
  if (
    /ExpoModulesCore|UnexpectedException|network connection was lost|Network request failed|failed to fetch|offline|internet connection/i.test(
      message
    )
  ) {
    return kind === "evidence"
      ? "Detailed location evidence could not be refreshed. Check your connection and try again."
      : "This action needs a connection and could not be completed. Your changes are still here.";
  }
  return kind === "evidence"
    ? "Detailed location evidence could not be loaded. Try again when you have a connection."
    : "This action could not be completed. Your changes are still here.";
}

export async function deleteRecentLocationEvidence() {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/location/evidence`, {
    method: "DELETE",
    headers: await authHeaders()
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to delete recent location evidence"));
  const server = await readJsonResponse<{ ok: true; deletedEvidenceCount: number }>(response);
  const local = await import("./location/store").then(({ deleteRetainedLocationEvidence }) =>
    deleteRetainedLocationEvidence()
  );
  return { ...server, localDeletedEvidenceCount: local.deletedCount };
}

export function confirmReviewItem(id: string) {
  return resolveReviewItem(id, "accept");
}

export function dismissReviewItem(id: string) {
  return resolveReviewItem(id, "ignore_once");
}

export async function reprocessHealthReviewItems(
  preferences: HealthImportPreferences,
  options: { limit?: number; force?: boolean; mappings?: HealthAutoLogMappings } = {}
): Promise<HealthReviewReprocessResult> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/review/reprocess-health`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ preferences, limit: options.limit, force: options.force, mappings: options.mappings })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to reprocess Health review items"));
  return readJsonResponse<HealthReviewReprocessResult>(response);
}

export async function saveEditedReviewItem(
  id: string,
  input: ManualTimeEntryInput,
  options: { atomicLocation?: boolean; clientMutationId?: string } = {}
) {
  void options.atomicLocation;
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/review/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({
      clientMutationId: options.clientMutationId ?? generatedUuid(),
      mutation: {
        action: "edit_and_confirm",
        edit: {
          categoryId: input.categoryId ?? null,
          description: input.description?.trim() || undefined,
          startedAt: input.startedAt,
          stoppedAt: input.stoppedAt,
          tags: input.tagNames
        }
      }
    })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to save reviewed activity"));
  return readJsonResponse(response);
}

export async function createCategory(
  name: string,
  options: { color?: string; isPinned?: boolean } = {}
): Promise<MobileCategoryResponse> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/categories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({
      name,
      color: options.color ?? "lime",
      isPinned: Boolean(options.isPinned)
    })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to create category"));
  return readJsonResponse(response);
}

export async function createTag(name: string): Promise<MobileTagResponse> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/tags`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ name })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to create tag"));
  return readJsonResponse(response);
}

export async function ensureAutomaticLoggingCategories(
  kinds: Array<"sleep" | "health" | "commute">
): Promise<MobileCategoryResponse[]> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/categories/automatic`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ kinds })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Unable to prepare automatic logging categories"));
  }
  const payload = await readJsonResponse<{ categories: MobileCategoryResponse[] }>(response);
  return payload.categories;
}

export async function updateCategory(
  id: string,
  options: { name?: string; color?: string; isPinned?: boolean }
): Promise<MobileCategoryResponse> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/categories`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ id, ...options })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update category"));
  return readJsonResponse(response);
}

export async function archiveCategory(id: string) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/categories?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders()
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to delete category"));
  return readJsonResponse(response);
}

export async function createPlace(input: { name: string } & PlaceMutationInput) {
  if (input.learnedPlaceId) {
    const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/places`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders())
      },
      body: JSON.stringify({
        name: input.name.trim(),
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        radiusMeters: input.radiusMeters ?? DEFAULT_PLACE_RADIUS_METERS,
        priority: input.priority ?? DEFAULT_PLACE_PRIORITY,
        defaultCategoryId: input.loggingEnabled === false ? null : input.defaultCategoryId ?? null,
        defaultActivityDescription: input.loggingEnabled === false ? null : input.defaultActivityDescription?.trim() || null,
        autoStart: false,
        loggingEnabled: input.loggingEnabled !== false,
        learnedPlaceId: input.learnedPlaceId
      })
    });
    if (response.status === 401) {
      throw new AuthRequiredError();
    }
    if (!response.ok) throw new Error(await errorMessage(response, "Unable to save learned place"));
    return readPlaceResponse(response, "Unable to save learned place");
  }

  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/entities`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({
      entity: "place",
      values: placeEntityValues(input)
    })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to save place"));

  const payload = await readApiJson<{ ok?: boolean } & ApiErrorPayload>(response, "Unable to save place");
  if (!payload.ok) throw new Error(payload.message);
  const apiError = formatApiError(payload.payload);
  if (apiError) throw new Error(apiError);

  const bootstrap = await fetchBootstrap();
  const place = findCreatedPlace(bootstrap.places, input);
  if (!place) {
    throw new Error("Place was saved, but the refreshed place list did not include it.");
  }
  return { ok: true, place };
}

export async function ignoreLearnedPlace(id: string) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/learned-places`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ id, status: "ignored" })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to ignore learned place"));
  return readApiJson<{ ok: true; id: string; status: "ignored" }>(response, "Unable to ignore learned place");
}

export async function resolveLearnedPlaceLocation(id: string, address: LocationDisplayAddress) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/learned-places`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ id, action: "resolve_location", address })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to resolve learned place"));
  return readJsonResponse<{
    ok: true;
    learnedPlace: Pick<
      MobileLearnedPlace,
      "id" | "name" | "address" | "poiName" | "formattedAddress" | "geocodedAt"
    >;
  }>(response);
}

export async function forgetLearnedPlace(id: string) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/learned-places?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders()
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to forget learned place"));
  return readApiJson<{ ok: true; id: string; status: "forgotten" }>(response, "Unable to forget learned place");
}

export async function updatePlace(id: string, input: PlaceMutationInput) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/places`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({
      id,
      ...input,
      autoStart: false
    })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update place"));
  return readPlaceResponse(response, "Unable to update place");
}

export async function deletePlace(id: string) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/places?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders()
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to delete place"));
  const payload = await readApiJson<{ ok?: boolean } & ApiErrorPayload>(response, "Unable to delete place");
  if (!payload.ok) throw new Error(payload.message);
  const apiError = formatApiError(payload.payload);
  if (apiError) throw new Error(apiError);
  return payload.payload;
}

export async function queueStopTimer() {
  return enqueueEvent({
    source: "mobile_app",
    type: "timer_stop",
    rawPayload: { origin: "mobile_home" }
  });
}

export function isNetworkTimerError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error instanceof MobileRequestTimeoutError ||
    isMobileTransportFailure(error)
  );
}

const permanentStatusCodes = new Set([400, 413, 422]);

function migrateQueuedEvent(
  item: StoredQueuedEvent,
  index: number,
  legacyOwner?: MobileAccountOwner
): QueuedEvent | null {
  const queueItem = { ...item };
  delete queueItem.workspaceId;
  delete queueItem.userId;
  delete queueItem.clientEventId;
  const userId = optionalQueueOwnerText(item.userId) ?? legacyOwner?.userId;
  const workspaceId = optionalQueueOwnerText(item.workspaceId) ?? legacyOwner?.workspaceId;
  if (!userId || !workspaceId) return null;

  const queuedAt = validIsoString(item.queuedAt) ?? new Date().toISOString();
  const localId = typeof item.localId === "string" && item.localId.trim()
    ? item.localId
    : `migrated-${queuedAt}-${index}`;
  const failureCount = typeof item.failureCount === "number" && Number.isFinite(item.failureCount)
    ? Math.max(0, Math.trunc(item.failureCount))
    : item.lastError || item.failedAt
      ? 1
      : undefined;
  const lastStatusCode = typeof item.lastStatusCode === "number" && Number.isFinite(item.lastStatusCode)
    ? Math.trunc(item.lastStatusCode)
    : undefined;
  const unscopedLegacyTimerStop = item.type === "timer_stop" && !hasCanonicalStopTarget(item.rawPayload);
  const failureKind = unscopedLegacyTimerStop
    ? "permanent"
    : isQueueFailureKind(item.failureKind)
    ? item.failureKind
    : lastStatusCode && permanentStatusCodes.has(lastStatusCode)
      ? "permanent"
      : undefined;

  return {
    ...queueItem,
    source: item.source as EventSource,
    type: item.type as ActivityEventType,
    occurredAt: coerceQueuedDate(item.occurredAt),
    rawPayload: isRecord(item.rawPayload) ? item.rawPayload : {},
    localId,
    queuedAt,
    userId,
    workspaceId,
    failedAt: unscopedLegacyTimerStop
      ? validIsoString(item.failedAt) ?? queuedAt
      : validIsoString(item.failedAt),
    failureCount: unscopedLegacyTimerStop ? Math.max(1, failureCount ?? 0) : failureCount,
    lastError: unscopedLegacyTimerStop
      ? "Legacy timer Stop has no canonical target and cannot be replayed safely."
      : typeof item.lastError === "string" && item.lastError.trim() ? item.lastError : undefined,
    lastStatusCode,
    lastAttemptedAt: validIsoString(item.lastAttemptedAt),
    nextRetryAt: validIsoString(item.nextRetryAt),
    failureKind
  };
}

function hasCanonicalStopTarget(rawPayload: unknown) {
  if (!isRecord(rawPayload)) return false;
  return rawPayload.stopScope === "entry" && isCanonicalEntryId(rawPayload.targetEntryId);
}

function isCanonicalEntryId(value: unknown) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function queuedEventFromParsedEvent(
  event: ReturnType<typeof ActivityEventInputSchema.parse>
): QueueableEvent {
  return {
    source: event.source,
    type: event.type,
    occurredAt: event.occurredAt,
    deviceId: event.deviceId,
    projectId: event.projectId,
    categoryId: event.categoryId,
    placeId: event.placeId,
    description: event.description,
    rawPayload: event.rawPayload
  };
}

function queuedEventRequestBody(item: QueuedEvent) {
  return {
    source: item.source,
    type: item.type,
    occurredAt: item.occurredAt.toISOString(),
    deviceId: item.deviceId,
    clientEventId: item.localId,
    projectId: item.projectId,
    categoryId: item.categoryId,
    placeId: item.placeId,
    description: item.description,
    rawPayload: item.rawPayload
  };
}

function markQueueFailure(
  item: QueuedEvent,
  message: string,
  attemptedAt: string,
  failureKind: QueueFailureKind,
  statusCode?: number
): QueuedEvent {
  const nextRetryAt = nextQueueRetryAt(attemptedAt, (item.failureCount ?? 0) + 1, failureKind);
  return {
    ...item,
    failedAt: new Date().toISOString(),
    failureCount: (item.failureCount ?? 0) + 1,
    lastError: message,
    lastStatusCode: statusCode,
    lastAttemptedAt: attemptedAt,
    nextRetryAt,
    failureKind
  };
}

function hasQueueFailure(item: QueuedEvent) {
  return Boolean(item.failedAt || item.lastError || (item.failureCount ?? 0) > 0);
}

function isPermanentlyFailedEvent(item: QueuedEvent) {
  return (
    item.failureKind === "permanent" ||
    Boolean(item.failedAt && item.lastStatusCode && permanentStatusCodes.has(item.lastStatusCode))
  );
}

function isClearableFailedEvent(item: QueuedEvent) {
  return isPermanentlyFailedEvent(item);
}

const retryBackoffSeconds = [30, 120, 300, 900, 1800, 3600];

function nextQueueRetryAt(attemptedAt: string, failureCount: number, failureKind: QueueFailureKind) {
  if (failureKind === "permanent") return undefined;
  const attemptedDate = new Date(attemptedAt);
  const baseMs = Number.isNaN(attemptedDate.getTime()) ? Date.now() : attemptedDate.getTime();
  const backoffSeconds = retryBackoffSeconds[Math.min(Math.max(failureCount, 1), retryBackoffSeconds.length) - 1];
  return new Date(baseMs + backoffSeconds * 1000).toISOString();
}

function isQueueRetryDue(item: QueuedEvent, now: Date) {
  if (!item.nextRetryAt) return true;
  const retryAt = new Date(item.nextRetryAt);
  if (Number.isNaN(retryAt.getTime())) return true;
  return retryAt.getTime() <= now.getTime();
}

function queueFailureReport(
  item: QueuedEvent,
  message: string,
  failureKind: QueueFailureKind,
  statusCode?: number
): QueueFailureReport {
  return {
    localId: item.localId,
    source: String(item.source ?? "unknown"),
    type: String(item.type ?? "unknown"),
    occurredAt: item.occurredAt.toISOString(),
    message,
    statusCode,
    failureKind
  };
}

function earliestIso(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(validIsoString(value)))
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0];
}

function latestIso(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(validIsoString(value)))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
}

function reconcileActivityQueueDrain(input: {
  owner: MobileAccountOwner;
  processed: readonly QueuedEvent[];
  remaining: readonly QueuedEvent[];
  synced: readonly string[];
}) {
  return withQueueMutation(async () => {
    const current = await readAllQueue(input.owner);
    const processedIds = new Set(input.processed.map((item) => item.localId));
    const syncedIds = new Set(input.synced);
    const remainingById = new Map(input.remaining.map((item) => [item.localId, item]));
    const next = current.flatMap((item) => {
      if (
        !mobileAccountOwnersEqual(item, input.owner) ||
        !processedIds.has(item.localId)
      ) {
        return [item];
      }
      if (syncedIds.has(item.localId)) return [];
      const processed = remainingById.get(item.localId);
      if (!processed) return [item];
      return [{
        ...item,
        ...(processed.failedAt ? { failedAt: processed.failedAt } : {}),
        ...(processed.failureCount === undefined ? {} : { failureCount: processed.failureCount }),
        ...(processed.lastError ? { lastError: processed.lastError } : {}),
        ...(processed.lastStatusCode === undefined
          ? {}
          : { lastStatusCode: processed.lastStatusCode }),
        ...(processed.lastAttemptedAt ? { lastAttemptedAt: processed.lastAttemptedAt } : {}),
        ...(processed.nextRetryAt ? { nextRetryAt: processed.nextRetryAt } : {}),
        ...(processed.failureKind ? { failureKind: processed.failureKind } : {})
      }];
    });
    await writeAllQueue(next);
    return next.filter((item) => mobileAccountOwnersEqual(item, input.owner));
  });
}

function formatRetryIso(value?: string) {
  return value ?? "after the retry window";
}

function queueSyncResult(
  synced: string[],
  remaining: QueuedEvent[],
  firstError: QueueFailureReport | undefined,
  stopped: boolean,
  timerEntryIdCorrelations: TimerEntryIdCorrelation[] = []
): SyncQueueResult {
  const failed = remaining.filter(hasQueueFailure);
  return {
    synced,
    timerEntryIdCorrelations,
    remaining,
    failed,
    syncedCount: synced.length,
    remainingCount: remaining.length,
    failedCount: failed.length,
    firstError,
    stopped
  };
}

function normalizeLocalId(value?: string) {
  const localId = value?.trim();
  return localId ? localId.slice(0, 160) : undefined;
}

function generatedLocalId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function generatedUuid() {
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join("-");
}

function withQueueMutation<Result>(operation: () => Promise<Result>) {
  const result = queueMutationTail.catch(() => undefined).then(operation);
  queueMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

function withTimerEntryIdCorrelationMutation<Result>(operation: () => Promise<Result>) {
  const result = timerEntryIdCorrelationMutationTail
    .catch(() => undefined)
    .then(operation);
  timerEntryIdCorrelationMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function readAllQueue(legacyOwner?: MobileAccountOwner): Promise<QueuedEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  let parsed: StoredQueuedEvent[];
  try {
    const value = JSON.parse(raw) as unknown;
    parsed = Array.isArray(value) ? value as StoredQueuedEvent[] : [];
  } catch {
    parsed = [];
  }
  const migrated = parsed.flatMap((item, index) => {
    const event = migrateQueuedEvent(item, index, legacyOwner);
    return event ? [event] : [];
  });
  if (
    migrated.length !== parsed.length ||
    parsed.some((item) => !optionalQueueOwnerText(item.userId) || !optionalQueueOwnerText(item.workspaceId))
  ) {
    await writeAllQueue(migrated);
  }
  return migrated;
}

async function writeAllQueue(queue: QueuedEvent[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  for (const listener of activityQueueListeners) listener();
}

function coerceQueuedDate(value: StoredQueuedEvent["occurredAt"]) {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function validIsoString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}

function isQueueFailureKind(value: unknown): value is QueueFailureKind {
  return value === "network" || value === "server" || value === "permanent";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

type TimerEntryIdCorrelationRecord = MobileAccountOwner & {
  localId: string;
  timeEntryId: string;
};

async function readAllTimerEntryIdCorrelations(
  legacyOwner?: MobileAccountOwner
): Promise<TimerEntryIdCorrelationRecord[]> {
  const raw = await AsyncStorage.getItem(TIMER_ENTRY_ID_CORRELATIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.flatMap((value) => {
        if (!isRecord(value)) return [];
        const userId = optionalQueueOwnerText(value.userId);
        const workspaceId = optionalQueueOwnerText(value.workspaceId);
        const localId = optionalQueueOwnerText(value.localId);
        const timeEntryId = optionalQueueOwnerText(value.timeEntryId);
        return userId && workspaceId && localId && timeEntryId
          ? [{ userId, workspaceId, localId, timeEntryId }]
          : [];
      });
    }
    if (!isRecord(parsed) || !legacyOwner) return [];
    const migrated = Object.entries(parsed).flatMap(([localId, timeEntryId]) =>
      localId && typeof timeEntryId === "string" && timeEntryId
        ? [{ ...legacyOwner, localId, timeEntryId }]
        : []
    );
    await AsyncStorage.setItem(TIMER_ENTRY_ID_CORRELATIONS_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

function optionalQueueOwnerText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Login required");
    this.name = "AuthRequiredError";
  }
}

async function authenticate(path: string, body: Record<string, unknown>): Promise<MobileAuthResult> {
  const response = await mobileFetchWithTimeout(
    `${DAYFRAME_API_BASE}${path}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    {
      timeoutMilliseconds: MOBILE_OPENING_REQUEST_TIMEOUT_MS,
      timeoutMessage: `${path.endsWith("/login") ? "Login" : "Account creation"} is taking too long. Check your connection and try again.`
    }
  );
  const payload = await readJsonResponse<MobileAuthResult & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error ?? `Authentication failed: ${response.status}`);
  if ("requiresEmailConfirmation" in payload) return payload;
  const owner = {
    userId: payload.user.id,
    workspaceId: payload.workspace.id
  };
  await setSessionToken(payload.token, owner);
  await activateMobileAccount(owner);
  const reviewStore = await reviewSyncStore();
  if (reviewStore) {
    await reviewStore.activateReviewAccount({
      userId: payload.user.id,
      workspaceId: payload.workspace.id,
      workspaceName: payload.workspace.name
    });
    void reviewStore.synchroniseReviewMutations().catch(() => undefined);
  }
  return payload;
}

async function reviewSyncStore() {
  // Expo SQLite loads native React Native modules that are intentionally absent
  // from the Node-only API-client unit-test runtime.
  if (typeof process !== "undefined" && process.env.VITEST) return null;
  return import("./reviewSyncStore");
}

async function postTimerAction(body: Record<string, unknown>) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/time-entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Timer action failed"));
  return readJsonResponse<TimerActionResult>(response);
}

async function authHeaders(): Promise<Record<string, string>> {
  const owner = await readActiveMobileAccount();
  if (!owner) return {};
  const sessionRead = await readOwnedAuthenticatedSessionSnapshot(owner);
  if (sessionRead.status === "signed_out") return {};
  if (sessionRead.status !== "authenticated") {
    throw new StaleMobileSessionResponseError();
  }
  return { Authorization: `Bearer ${sessionRead.snapshot.token}` };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const result = await readApiJson<T>(response, "Unexpected server response");
  if (result.ok) return result.payload;
  return { error: result.message } as T;
}

async function readApiJson<T>(response: Response, fallback: string): Promise<ApiJsonRead<T>> {
  const text = await response.text();
  if (!text) return { ok: true, payload: {} as T };
  try {
    return { ok: true, payload: JSON.parse(text) as T };
  } catch {
    logNonJsonApiResponse(response, text);
    return { ok: false, message: nonJsonApiMessage(response, text, fallback) };
  }
}

async function readPlaceResponse(response: Response, fallback: string): Promise<MobilePlaceResponse> {
  const result = await readApiJson<Partial<MobilePlaceResponse> & ApiErrorPayload>(response, fallback);
  if (!result.ok) throw new Error(result.message);
  const payload = result.payload;
  if (!payload.place || typeof payload.place.id !== "string" || !payload.place.id.trim()) {
    throw new Error(formatApiError(payload) ?? fallback);
  }
  return payload as MobilePlaceResponse;
}

async function errorMessage(response: Response, fallback: string) {
  const result = await readApiJson<ApiErrorPayload>(response, fallback);
  if (!result.ok) return result.message;
  const payload = result.payload;
  return formatApiError(payload) ?? `${fallback}: ${response.status}`;
}

function formatApiError(payload: ApiErrorPayload) {
  if (payload.issues?.length) {
    return formatIssue(payload.issues[0]);
  }

  const message = payload.error ?? payload.message;
  if (!message) return formatBlockingEntry(payload);

  try {
    const parsed = JSON.parse(message) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const issue = parsed[0] as { path?: Array<string | number>; message?: string };
      return formatIssue(issue);
    }
  } catch {
    return [message, formatBlockingEntry(payload)].filter(Boolean).join(" ");
  }

  return [message, formatBlockingEntry(payload)].filter(Boolean).join(" ");
}

function formatBlockingEntry(payload: ApiErrorPayload) {
  const blockingEntry = payload.blockingEntry;
  if (!blockingEntry) return undefined;
  const label = blockingEntry.description?.trim() || blockingEntry.source || "existing entry";
  const status = blockingEntry.reviewStatus ? ` (${blockingEntry.reviewStatus})` : "";
  return `Blocked by ${label}${status}.`;
}

function placeEntityValues(input: { name: string } & PlaceMutationInput) {
  return {
    name: input.name.trim(),
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    radiusMeters: input.radiusMeters ?? DEFAULT_PLACE_RADIUS_METERS,
    priority: input.priority ?? DEFAULT_PLACE_PRIORITY,
    categoryId: input.loggingEnabled === false ? null : input.defaultCategoryId ?? null,
    defaultActivityDescription: input.loggingEnabled === false ? null : input.defaultActivityDescription?.trim() || null,
    autoStart: false,
    loggingEnabled: input.loggingEnabled !== false
  };
}

function findCreatedPlace(places: MobilePlace[], input: { name: string } & PlaceMutationInput) {
  const values = placeEntityValues(input);
  return places.find((place) =>
    place.name.trim() === values.name &&
    sameNullableNumber(place.latitude, values.latitude) &&
    sameNullableNumber(place.longitude, values.longitude) &&
    Number(place.radiusMeters) === Number(values.radiusMeters) &&
    (place.defaultCategoryId ?? null) === values.categoryId &&
    (place.defaultActivityDescription ?? null) === values.defaultActivityDescription &&
    (place.loggingEnabled ?? true) === values.loggingEnabled
  ) ?? null;
}

function sameNullableNumber(left?: number | null, right?: number | null) {
  if (left == null || right == null) return left == null && right == null;
  return Math.abs(left - right) < 0.000001;
}

function nonJsonApiMessage(response: Response, text: string, fallback: string) {
  if (isRouteNotFoundHtml(response, text)) {
    return `${fallback}. The server route was not found.`;
  }
  return `${fallback}. The server returned an unexpected response.`;
}

function isRouteNotFoundHtml(response: Response, text: string) {
  return response.status === 404 || /404:\s*this page could not be found/i.test(text);
}

function logNonJsonApiResponse(response: Response, text: string) {
  const bodyPreview = text.replace(/\s+/g, " ").slice(0, 500);
  console.warn("Dayframe API returned a non-JSON response.", {
    status: response.status,
    url: response.url || undefined,
    contentType: response.headers.get("content-type") ?? undefined,
    bodyPreview
  });
}

function formatIssue(issue: { path?: Array<string | number>; message?: string }) {
  const path = issue.path?.length ? issue.path.join(".") : "event";
  return issue.message ? `${path}: ${issue.message}` : "Invalid event payload";
}
