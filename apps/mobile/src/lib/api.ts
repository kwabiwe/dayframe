import { DAYFRAME_BACKEND_ID } from "./backendIdentity";
import type { HealthCaptureOwner } from "./healthSyncStore";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { subscribeMobileSignedOut } from "./mobileSessionTransition";
import { AppState } from "react-native";
import {
  ActivityEventInputSchema,
  LocationReviewEvidenceDtoSchema,
  REVIEW_COUNT_CARDS,
  REVIEW_COUNT_REQUEST_HEADER,
  type ActivityEventInput,
  type PlaceVisitStats,
  type ActivityEventType,
  type CategoryUsageRank,
  type EventSource,
  type HealthAutoLogMappings,
  type HealthImportPreferences,
  type LocationDisplayAddress,
  type LocationRolloutMode,
  type LocationReviewAction,
  type LocationReviewEvidenceDto,
  type PlaceRole,
  type RecentActivitySuggestion,
  type TimerStateFingerprint
} from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "./config";
import {
  MobileApiResponseError,
  MobileHttpResponseError,
  MobileRequestTimeoutError,
  StaleMobileSessionResponseError,
  isMobileTransportFailure,
  mobileFetch,
  mobileJsonRequest,
  InvalidMobileAcknowledgementError,
  mobileFetchWithTimeout
} from "./mobile-network";
import {
  bindAuthenticatedSessionOwner,
  clearSessionToken,
  getSessionToken,
  isAuthenticatedSessionSnapshotCurrent,
  readAuthenticatedSessionSnapshot,
  readOwnedAuthenticatedSessionSnapshot,
  setSessionToken,
  subscribeAuthenticatedSession
} from "./secure-session";
import {
  activateMobileAccount,
  deactivateMobileAccount,
  getActiveMobileAccountSnapshot,
  subscribeActiveMobileAccount,
  mobileAccountKey,
  mobileAccountOwnersEqual,
  readActiveMobileAccount,
  type MobileAccountOwner
} from "./mobileAccount";
import {
  markPendingTimerStopFailure,
  readPendingTimerStops,
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
import { withJsTask } from "./jsTasks";

const QUEUE_KEY = "dayframe.offlineQueue.v1";
const TIMER_ENTRY_ID_CORRELATIONS_KEY = "dayframe.timerEntryIdCorrelations.v1";
/**
 * Unreadable queue or correlation containers are moved here, never dropped (stability audit 22 Oct 2026,
 * iphone-timer-sync-12). Device-scoped: a corrupt blob has no trustworthy owner. At most
 * `STORAGE_QUARANTINE_MAX_PER_CONTAINER` raw blobs are kept per container; support details report only
 * their reason, time and size, never their contents.
 */
const STORAGE_QUARANTINE_KEY = "dayframe.offlineQueue.quarantine.v1";
const STORAGE_QUARANTINE_MAX_PER_CONTAINER = 2;
/**
 * A copy's contents are deleted after 7 days, before logout revokes the session, before another
 * account's session is installed, and at every launch for any copy the session authority's account
 * does not own (a copy made signed out survives only the launch that made it). A metadata note stays.
 */
const STORAGE_QUARANTINE_LAUNCH = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
const STORAGE_QUARANTINE_RAW_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const STORAGE_QUARANTINE_MAX_NOTES = 5;
let storageQuarantineMutationTail: Promise<void> = Promise.resolve();
/**
 * Correlation bound (stability audit 22 Oct 2026, iphone-timer-sync-7): a correlation is removed only
 * once it is more than 30 days old and nothing names it. See `pruneTimerEntryIdCorrelations`.
 */
const TIMER_ENTRY_ID_CORRELATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
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
/**
 * Timer events and the rest of the queue (Health, location) drain on separate per-owner lanes, so a
 * Start, Stop or Switch and its correlation never wait behind a slow non-timer upload (stability audit
 * 22 Oct 2026, iphone-timer-sync-5). Each lane stays serialised per owner; the two touch disjoint items.
 */
type ActivityQueueLane = "timer" | "non_timer";
const activityQueueSyncInFlightByLane = new Map<string, ActiveActivityQueueSync>();
const activityQueueListeners = new Set<() => void>();

// Request cancellation follows the existing captured session predicate. It is
// separate from Location's longer-lived, fail-closed cleanup/admission fence.
type BootstrapLogoutRequest = { revision: number; isSessionCurrent: () => boolean };
let latestBootstrapLogoutRequest: BootstrapLogoutRequest | null = null;
const activeBootstrapLogoutRequests = new Set<BootstrapLogoutRequest>();

function captureBootstrapLogoutGuard() {
  const revision = latestBootstrapLogoutRequest?.revision ?? 0;
  return () => ![...activeBootstrapLogoutRequests].some(request => request.isSessionCurrent()) &&
    (!latestBootstrapLogoutRequest || latestBootstrapLogoutRequest.revision === revision ||
      !latestBootstrapLogoutRequest.isSessionCurrent());
}

function beginBootstrapLogoutRequest(isSessionCurrent: () => boolean) {
  const request = { revision: (latestBootstrapLogoutRequest?.revision ?? 0) + 1, isSessionCurrent };
  latestBootstrapLogoutRequest = request;
  activeBootstrapLogoutRequests.add(request);
  // Keep the revision after settlement: a response started before this logout
  // cannot become current again just because the failed request has ended.
  return () => { activeBootstrapLogoutRequests.delete(request); };
}

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
  /** Review cards, an outing once (PRD D19, PR 12c); absent from older servers. */
  reviewCardCount?: number;
  /** Each open Move folded into its outing's open Stay card (member → Stay), to move the count locally. */
  reviewOutingStays?: Record<string, string>;
  /** More open outing Moves than the server maps: it sent no map. */
  reviewOutingStaysOverflow?: boolean;
  /** Set on this iPhone when a local decision moved `reviewCardCount` without knowing by how much: not exact. */
  reviewCardCountApproximate?: boolean;
  /** Set on this iPhone: the cards already taken off `reviewCardCount` here, so a re-projection skips them. */
  reviewCardCountAppliedIds?: string[];
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
  /** For a block a Move logged by itself (PRD D19), its Move's event, for "Don't log trips like this". */
  automaticMoveEventId?: string | null;
  /** A member of a named A → B → A (location v3 PR 14): Today shows adjacent members as one row. */
  locationGroup?: { key: string; name: string; parts?: number } | null;
  source: string;
  confidence: string;
  reviewStatus: string;
  /** Server-verified: an owner decision in Review created this block (Recent learns from such visits). */
  confirmedInReview?: boolean;
  /** Server-verified: the owner typed this description while making the Review decision. */
  ownerAuthoredInReview?: boolean;
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
  /** Server-verified presentation discriminator for a cached targeted read. */
  presentationSourceKind?: "location_v2";
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
  /** Needs-review entries created from this suggestion (newer servers only). */
  linkedEntryIds?: string[];
};

export type MobileBootstrap = {
  serverBuild?: {sourceSha:string|null;deploymentId:string|null;backendId:string|null;environment:string;syncContractVersion:number};
  user: {
    id: string;
    email: string;
    name: string;
    dailyGoalMinutes?: number;
    weeklyGoalMinutes?: number;
    /** "Log trips automatically" (PRD D19, A4); absent on servers before it. */
    logTripsAutomatically?: boolean;
    /** The server order of the Settings values on the user row (goals and the trips switch). */
    goalsRevision?: number;
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
  // countsTowardGoal: false leaves the activity's time out of goal progress (UIA-043); an older
  // server leaves it out, and then every activity counts.
  categories: Array<{ id: string; name: string; color: string; isPinned: boolean; icon?: string | null; starterKey?: string | null; countsTowardGoal?: boolean }>;
  // Every activity, active or archived, that doesn't count toward the goal; `categories` holds only
  // active ones, so an archived Sleep's history stays out of goal progress. Older servers omit it.
  goalExcludedCategoryIds?: string[];
  tags?: MobileTag[];
  entries: MobileTimeEntry[];
  historyEntries?: MobileTimeEntry[];
  dayEntries?: MobileTimeEntry[];
  weekEntries?: MobileTimeEntry[];
  places: Array<{
    id: string;
    name: string;
    /** Home or Work; older servers omit it. The interface shows the role label instead of the name. */
    role?: PlaceRole | null;
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
    autoLog?: boolean;
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
  /** `previousArchived`: a create into a Home/Work slot archived the old holder ("Replace the old place"). */
  place: MobilePlace & { previousArchived?: boolean };
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
  /** "Log automatically" (owner decision 14 Oct 2026); the server keeps it off while logging is off. */
  autoLog?: boolean;
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
  nextCursor?: string | null;
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
  healthOwner?: HealthCaptureOwner;
  failedAt?: string;
  failureCount?: number;
  lastError?: string;
  lastStatusCode?: number;
  lastAttemptedAt?: string;
  nextRetryAt?: string;
  failureKind?: QueueFailureKind;
  /** When the server first refused this queued Start; kept across Retries so it is announced once. */
  refusedStartAt?: string;
  /** Server error replies to a non-timer event, and when the first came; they bound its automatic retries. */
  serverFailureCount?: number;
  firstServerFailureAt?: string;
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
  /** Of the permanent failures, those parked after repeated server errors (still slowly retried). */
  parkedFailedCount: number;
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
  /**
   * `health` sends only queued Apple Health events and, unlike the other non-timer work, also
   * while Dayframe is in the background: a HealthKit wake's bounded pass delivers its own capture.
   */
  eventScope?: "all" | "timer_mutations" | "non_timer" | "health";
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
  | "serverFailureCount"
  | "firstServerFailureAt"
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
  healthOwner?: HealthCaptureOwner;
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

/** Hands a Review count from any Dayframe reply to the evening reminder. Never blocks or throws. */
function noteReviewCountQuietly(owner: MobileAccountOwner | null, count: unknown) {
  if (typeof count !== "number") return;
  void import("./reviewNudge").then(({ noteReviewCount }) => noteReviewCount(owner, count)).catch(() => undefined);
}

export function fetchBootstrap(options: { date?: string; signal?: AbortSignal; deadlineAt?: number } = {}): Promise<MobileBootstrap> {
  return withJsTask("bootstrap", () => fetchBootstrapNow(options));
}

async function fetchBootstrapNow(options: { date?: string; signal?: AbortSignal; deadlineAt?: number }): Promise<MobileBootstrap> {
  const logoutAllowsResponse = captureBootstrapLogoutGuard();
  const requireLogoutAllowsResponse = () => { if (!logoutAllowsResponse()) throw new StaleMobileSessionResponseError(); };
  requireLogoutAllowsResponse();
  const params = options.date ? `?date=${encodeURIComponent(options.date)}` : "";
  const sessionRead = await readAuthenticatedSessionSnapshot();
  if (sessionRead.status === "changed") {
    throw new StaleMobileSessionResponseError();
  }
  const { response, body } = await mobileJsonRequest<MobileBootstrap | null>(
    `${DAYFRAME_API_BASE}/api/bootstrap${params}`,
    {
      signal: options.signal,
      headers: sessionRead.status === "authenticated"
        ? { Authorization: `Bearer ${sessionRead.snapshot.token}` }
        : {}
    },
    {
      timeoutMilliseconds: Math.max(1, Math.min(MOBILE_OPENING_REQUEST_TIMEOUT_MS, (options.deadlineAt ?? Date.now() + MOBILE_OPENING_REQUEST_TIMEOUT_MS) - Date.now())),
      isCurrent: () => logoutAllowsResponse() && (sessionRead.status !== "authenticated" || isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot)),
      validate: (body, response) => {
        if (!response.ok) return null;
        const value = body as MobileBootstrap | null;
        if (!value?.user?.id || !value.workspace?.id) throw new InvalidMobileAcknowledgementError();
        return value;
      },
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
      "Unable to load Dayframe API"
    );
  }
  if (!body) throw new InvalidMobileAcknowledgementError();
  const bootstrap = body;
  if (bootstrap.user?.id && bootstrap.workspace?.id) {
    const owner = {
      userId: bootstrap.user.id,
      workspaceId: bootstrap.workspace.id
    };
    // Refuse the departing response before even binding a legacy token's owner.
    if (!logoutAllowsResponse() || (sessionRead.status === "authenticated" &&
      !isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot))) throw new StaleMobileSessionResponseError();
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
    const requireBootstrapCurrent = () => {
      // Owner binding may have filled in a legacy ownerless token above. Its
      // original generation/token still identify this response's lifetime.
      if ((sessionRead.status === "authenticated" &&
        !isAuthenticatedSessionSnapshotCurrent({ ...sessionRead.snapshot, owner })) ||
        !logoutAllowsResponse()) throw new StaleMobileSessionResponseError();
    };
    requireBootstrapCurrent();
    await activateMobileAccount(owner);
    requireBootstrapCurrent();
    noteReviewCountQuietly(owner, bootstrap.stats?.reviewCardCount ?? bootstrap.stats?.reviewCount);
  }
  const reviewStore = await reviewSyncStore();
  requireLogoutAllowsResponse();
  if (!reviewStore) return bootstrap;
  const projected = await reviewStore.processReviewBootstrap(bootstrap);
  requireLogoutAllowsResponse();
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
    throw await apiResponseError(response, "Couldn't check what's recording");
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
    throw await apiResponseError(response, "Unable to register Live Activity");
  }
}

export async function login(email: string, password: string) {
  return authenticate("/api/auth/login", { email, password });
}

/** A new account gets its personal workspace, renamed later on the web (UIA-318). */
export async function signup(email: string, password: string, name?: string) {
  return authenticate("/api/auth/signup", { email, password, name });
}

/**
 * Forgot password (UIA-317): the server asks Supabase to email a reset link (the reset page is on
 * the web) and answers the same way for any address.
 */
export async function requestPasswordReset(email: string) {
  const response = await mobileFetchWithTimeout(
    `${DAYFRAME_API_BASE}/api/auth/password-reset`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) },
    { timeoutMilliseconds: MOBILE_OPENING_REQUEST_TIMEOUT_MS, timeoutMessage: "This is taking too long. Check your connection and try again." }
  );
  const payload = await readJsonResponse<{ message?: string; error?: string }>(response).catch(() => ({} as { message?: string; error?: string }));
  if (response.status === 404) throw new MobileApiResponseError(404, "Password reset isn't available here.", true);
  if (!response.ok) {
    throw new MobileApiResponseError(response.status, payload.error ?? "Dayframe couldn't send the reset email. Try again.", Boolean(payload.error));
  }
  return payload.message ?? "If an account uses that email, a reset link is on its way. Check your email.";
}

/** Sign-in failures in plain words (UIA-320); anything unrecognised keeps the server's sentence. */
export function plainAuthError(message: string | undefined, status: number) {
  const text = message ?? "";
  if (/invalid login credentials|invalid email or password/i.test(text)) return "That email and password don't match.";
  if (/email not confirmed/i.test(text)) return "Confirm your email first, then log in.";
  if (/already registered|already exists/i.test(text)) return "An account already uses that email. Log in instead.";
  // Only a password-only rule is rephrased; a combined email-and-password message stays whole.
  if (/password should be at least/i.test(text) || (/at least 8/i.test(text) && !/email/i.test(text))) {
    return "Use at least 8 characters for the password.";
  }
  if (status === 429) return "Too many tries. Wait a minute, then try again.";
  if (status >= 500 || !text) return "Dayframe couldn't sign you in. Try again in a moment.";
  return text;
}

// Any way the session ends (sign-out, expiry, a revoked session) takes the evening Review reminder
// with it: it belongs to the account that left. A rejected session is announced only through the
// signed-out event, a cleared token through the session listeners, so both are heard.
function cancelReviewNudgeAfterSignOut() {
  void import("./reviewNudge").then(({ cancelReviewNudgeForLogout }) => cancelReviewNudgeForLogout()).catch(() => undefined);
}
subscribeMobileSignedOut(cancelReviewNudgeAfterSignOut);
subscribeAuthenticatedSession(() => {
  void readAuthenticatedSessionSnapshot().then((read) => {
    if (read.status === "signed_out") cancelReviewNudgeAfterSignOut();
  }).catch(() => undefined);
});

export async function logout() {
  void endAllTimerBackgroundExecution("logout");
  // Capture the existing session authority before any await. A delayed logout
  // must not stop capture or clear a replacement login (including A -> B -> A).
  let sessionChanged = false;
  const unsubscribe = subscribeAuthenticatedSession(() => { sessionChanged = true; });
  const sessionRead = readAuthenticatedSessionSnapshot();
  const ownerRead = readActiveMobileAccount();
  let finishLocationLogout: (() => void) | undefined;
  let finishBootstrapLogoutRequest: (() => void) | undefined;
  let logoutSucceeded = false;
  let logoutSessionIsCurrent = () => false;
  try {
    const session = await sessionRead;
    const activeOwner = await ownerRead;
    const logoutOwner = session.status === "authenticated" ? session.snapshot.owner ?? activeOwner : activeOwner;
    if (activeOwner && logoutOwner && !mobileAccountOwnersEqual(activeOwner, logoutOwner)) throw new StaleMobileSessionResponseError();
    let accountDeactivated = false;
    const isSessionCurrent = () => session.status === "authenticated"
      ? isAuthenticatedSessionSnapshotCurrent(session.snapshot) ||
        (!session.snapshot.owner && Boolean(logoutOwner) &&
          isAuthenticatedSessionSnapshotCurrent({ ...session.snapshot, owner: logoutOwner }))
      : session.status === "signed_out" && !sessionChanged;
    const isCurrent = () => isSessionCurrent() &&
      mobileAccountOwnersEqual(getActiveMobileAccountSnapshot(), accountDeactivated ? null : activeOwner);
    logoutSessionIsCurrent = isCurrent;
    const requireCurrent = () => { if (!isCurrent()) throw new StaleMobileSessionResponseError(); };
    requireCurrent();
    finishBootstrapLogoutRequest = beginBootstrapLogoutRequest(isSessionCurrent);
    await import("./location/runtime").then(({ beginLocationLogout, endLocationCaptureOwnership }) => {
      requireCurrent();
      // Account removal is not a new authenticated lifetime. The bootstrap
      // fence remains valid through that I/O until this session is cleared.
      finishLocationLogout = beginLocationLogout(logoutOwner, isSessionCurrent);
      return endLocationCaptureOwnership("logout", logoutOwner ?? undefined, isCurrent);
    });
    requireCurrent();
    // Recorded before the server session is revoked, so the Health journal expiry started below is
    // retried at a later launch, signed out or not; a failed write fails logout while still signed in
    // (Codex r1 and r2 on #549).
    const healthExpiryMarker = await import("./healthSignOut")
      .then(({ markSignedOutHealthExpiryPending }) => markSignedOutHealthExpiryPending(logoutOwner ?? null));
    requireCurrent();
    // Quarantined queue/correlation contents leave with the account, before the session is revoked; a
    // failed delete fails logout while still signed in (Codex r2 on #552).
    await purgeStorageQuarantineContents({ removal: "logout" });
    requireCurrent();
    const token = session.status === "authenticated" ? session.snapshot.token : null;
    await mobileFetch(`${DAYFRAME_API_BASE}/api/auth/logout`, {
      method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}
    }).catch(() => undefined);
    requireCurrent();
    await import("./reviewSyncStore").then(({ clearActiveReviewAccountData }) => {
      requireCurrent();
      return clearActiveReviewAccountData();
    }).catch(() => undefined);
    requireCurrent();
    await import("./shortcuts").then(async ({ clearActiveOwnerNativeShortcutQueue, clearShortcutCatalog }) => {
      requireCurrent();
      if (activeOwner) await clearActiveOwnerNativeShortcutQueue(activeOwner).catch(() => 0);
      requireCurrent();
      clearShortcutCatalog();
    }).catch(() => undefined);
    requireCurrent();
    if (activeOwner) await deactivateMobileAccount(activeOwner);
    accountDeactivated = true;
    requireCurrent();
    await clearSessionToken();
    logoutSucceeded = true;
    // The evening Review reminder belongs to the account that just left.
    void import("./reviewNudge").then(({ cancelReviewNudgeForLogout }) => cancelReviewNudgeForLogout()).catch(() => undefined);
    // So do its Health journal and HealthKit's background wakes (health-3, health-4). Unsettled
    // Health deliveries stay with the durable queue that still holds them; the recorded expiry
    // survives a failure here.
    void import("./healthSignOut").then(({ endHealthCaptureAfterLogout }) => endHealthCaptureAfterLogout(healthExpiryMarker)).catch(() => undefined);
  } finally {
    unsubscribe();
    finishBootstrapLogoutRequest?.();
    // A failed local cleanup stays fenced until retry or a newer session.
    if (logoutSucceeded || !logoutSessionIsCurrent()) finishLocationLogout?.();
  }
}

export { clearSessionToken, getSessionToken };

export async function enqueueEvent(input: ActivityEventDraft) {
  const result = await enqueueActivityEvents([input]);
  if (result.error !== undefined) throw result.error;
  return result.queue;
}

export type EnqueueEventsResult = {
  /** How many events, from the start of the batch, are now queued (new or already there). */
  acceptedCount: number;
  /** Why the event at `acceptedCount` could not be queued; the ones before it were still written. */
  error?: unknown;
};

/**
 * Queues many events with one read and one write of the queue under the shared queue lock (stability
 * audit 22 Oct 2026, iphone-timer-sync-8: a Health handoff used to rewrite the whole queue per event).
 * Events are taken in order with `enqueueEvent`'s rules; the first one that cannot be queued stops the
 * batch, and the ones before it are kept, as a loop of `enqueueEvent` calls would.
 */
export async function enqueueEvents(inputs: readonly ActivityEventDraft[]): Promise<EnqueueEventsResult> {
  if (inputs.length === 0) return { acceptedCount: 0 };
  const { acceptedCount, error } = await enqueueActivityEvents(inputs);
  return error === undefined ? { acceptedCount } : { acceptedCount, error };
}

function enqueueActivityEvents(inputs: readonly ActivityEventDraft[]) {
  return withQueueMutation(async () => {
    const activeOwner = await readActiveMobileAccount();
    let all: QueuedEvent[] | null = null;
    let changed = false;
    let acceptedCount = 0;
    let error: unknown;
    let lastOwner: MobileAccountOwner | null = null;
    const reservationOwners = new Map<string, MobileAccountOwner>();
    const ownedLocalIds = new Map<string, Set<string>>();
    let untaggedByLocalId: Map<string, QueuedEvent> | null = null;
    const ownedIdsFor = (queue: readonly QueuedEvent[], owner: MobileAccountOwner) => {
      const key = mobileAccountKey(owner);
      let ids = ownedLocalIds.get(key);
      if (!ids) {
        ids = new Set(queue.filter((item) => queuedEventMatchesOwner(item, owner)).map((item) => item.localId));
        ownedLocalIds.set(key, ids);
      }
      return ids;
    };
    for (const input of inputs) {
      try {
        const owner = input.owner ?? activeOwner;
        if (!owner || !mobileAccountOwnersEqual(activeOwner, owner)) {
          throw new Error("An authenticated account is required to queue activity.");
        }
        const isHealth = input.source === "health_sleep" || input.source === "health_workout";
        const healthOwner = input.healthOwner ?? (isHealth && DAYFRAME_BACKEND_ID ? {...owner, backendId:DAYFRAME_BACKEND_ID} : undefined);
        if (isHealth && (!healthOwner || !DAYFRAME_BACKEND_ID || healthOwner.backendId !== DAYFRAME_BACKEND_ID || !mobileAccountOwnersEqual(owner,healthOwner))) {
          throw new StaleMobileSessionResponseError();
        }
        const {
          localId,
          owner: _owner,
          healthOwner: _healthOwner,
          requestImmediateDelivery,
          ...eventInput
        } = input;
        const parsed = ActivityEventInputSchema.parse({
          ...eventInput,
          occurredAt: input.occurredAt ?? new Date(),
          rawPayload: eventInput.rawPayload ?? {}
        });
        all ??= await readAllQueue(owner);
        const queuedIds = ownedIdsFor(all, owner);
        const queuedLocalId = normalizeLocalId(localId) ?? generatedLocalId();
        const reserve = requestImmediateDelivery && isExplicitTimerMutationEventType(parsed.type);
        // A journal handoff is admitted only while its delivery is still owed, under this queue lock that
        // Clear's discard also holds: a handoff working from an earlier snapshot cannot re-add a cleared
        // event (Codex r3 on #549). A settled one counts as handled, as `enqueueEvent` returned for it.
        if (input.healthOwner && queuedLocalId.startsWith("healthkit:") && !queuedIds.has(queuedLocalId)) {
          const { isHealthDeliveryOpen } = await import("./healthSyncStore");
          if (!await isHealthDeliveryOpen(input.healthOwner, queuedLocalId)) {
            acceptedCount += 1;
            lastOwner = owner;
            continue;
          }
        }
        if (queuedIds.has(queuedLocalId)) {
          if (reserve) reservationOwners.set(mobileAccountKey(owner), owner);
          acceptedCount += 1;
          lastOwner = owner;
          continue;
        }
        const nextItem: QueuedEvent = {
          ...queuedEventFromParsedEvent(parsed),
          localId: queuedLocalId,
          queuedAt: new Date().toISOString(),
          userId: owner.userId,
          workspaceId: owner.workspaceId,
          ...(healthOwner ? {healthOwner} : {})
        };
        // A journal-owned same-ID replay may repair a pre-upgrade untagged handoff only
        // when its complete immutable event body agrees. Owner UUIDs alone are not proof.
        let legacy: QueuedEvent | undefined;
        if (input.healthOwner && localId?.startsWith("healthkit:")) {
          if (!untaggedByLocalId) {
            untaggedByLocalId = new Map<string, QueuedEvent>();
            for (const item of all) {
              if (!item.healthOwner && !untaggedByLocalId.has(item.localId)) untaggedByLocalId.set(item.localId, item);
            }
          }
          const candidate: QueuedEvent | undefined = untaggedByLocalId.get(queuedLocalId);
          legacy = candidate && mobileAccountOwnersEqual(candidate, owner) ? candidate : undefined;
        }
        if (legacy) {
          const {canonicalHealthJson} = await import("./healthFingerprint");
          if (canonicalHealthJson(queuedEventRequestBody(legacy)) !== canonicalHealthJson(queuedEventRequestBody(nextItem))) {
            throw new Error("The retained Health event does not match its capture journal. It was preserved for review.");
          }
          const repaired: QueuedEvent = legacy;
          all = all.map((item): QueuedEvent => item === repaired ? {...item, healthOwner} : item);
          untaggedByLocalId?.delete(queuedLocalId);
        } else {
          all = [...all, nextItem];
        }
        queuedIds.add(queuedLocalId);
        changed = true;
        if (reserve) reservationOwners.set(mobileAccountKey(owner), owner);
        acceptedCount += 1;
        lastOwner = owner;
      } catch (caught) {
        error = caught;
        break;
      }
    }
    if (changed && all) await writeAllQueue(all);
    for (const owner of reservationOwners.values()) {
      await reserveTimerBackgroundExecution(
        activityQueueBackgroundExecutionKey(owner),
        "Dayframe timer Start sync"
      );
    }
    const resultOwner = lastOwner;
    const queue = all && resultOwner ? all.filter((item) => queuedEventMatchesOwner(item, resultOwner)) : [];
    return { queue, acceptedCount, error };
  });
}

function queuedEventMatchesOwner(item: QueuedEvent, owner: MobileAccountOwner) {
  if (!mobileAccountOwnersEqual(item,owner)) return false;
  if (item.source !== "health_sleep" && item.source !== "health_workout") return true;
  return !!DAYFRAME_BACKEND_ID && item.healthOwner?.backendId === DAYFRAME_BACKEND_ID && mobileAccountOwnersEqual(item.healthOwner,owner);
}

export async function readQueue(owner?: MobileAccountOwner): Promise<QueuedEvent[]> {
  const resolvedOwner = owner ?? await readActiveMobileAccount();
  if (!resolvedOwner) return [];
  return (await readAllQueue(resolvedOwner, { unlocked: true }))
    .filter((item) => queuedEventMatchesOwner(item, resolvedOwner));
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
    const records = await readAllTimerEntryIdCorrelations(resolvedOwner, { forWrite: true });
    const next = records.filter((record) =>
      !mobileAccountOwnersEqual(record, resolvedOwner) || record.localId !== localId
    );
    next.push({ ...resolvedOwner, localId, timeEntryId, recordedAt: new Date().toISOString() });
    await writeAllTimerEntryIdCorrelations(next);
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
    const records = await readAllTimerEntryIdCorrelations(resolvedOwner, { forWrite: true });
    const next = records.filter((record) =>
      !mobileAccountOwnersEqual(record, resolvedOwner) || record.localId !== localId
    );
    if (next.length === records.length) return false;
    await writeAllTimerEntryIdCorrelations(next);
    return true;
  });
}

/**
 * Drops the owner's correlations nothing needs any more (stability audit 22 Oct 2026,
 * iphone-timer-sync-7). Age-only and conservative: a correlation goes only when it is more than 30
 * days old, no queued activity, Edit/Delete, Stop or refusal-fence record names it, and no open
 * presentation holds it (`retainLocalIds`). A record from before `recordedAt` existed is stamped now
 * on first sight, so its 30 days start then. Durable work is read only when some record is old enough,
 * and read again just before the write, inside the correlation lock.
 *
 * Remaining race (accepted): a brand-new command naming an optimistic ID more than 30 days old,
 * admitted between that final check and the write, would lose its mapping. Today's UI cannot do that:
 * new commands come from blocks on screen or in an open editor, and those IDs are retained.
 * Returns the local IDs it removed.
 */
export async function pruneTimerEntryIdCorrelations(input: {
  owner: MobileAccountOwner;
  retainLocalIds?: Iterable<string>;
  now?: Date;
}): Promise<string[]> {
  const nowMs = (input.now ?? new Date()).getTime();
  void sweepStorageQuarantine().catch(() => undefined);
  return withTimerEntryIdCorrelationMutation(async () => {
    const stored = await readAllTimerEntryIdCorrelations(input.owner, { forWrite: true });
    let stamped = false;
    const records = stored.map((record) => {
      if (record.recordedAt || !mobileAccountOwnersEqual(record, input.owner)) return record;
      stamped = true;
      return { ...record, recordedAt: new Date(nowMs).toISOString() };
    });
    const retained = new Set(input.retainLocalIds ?? []);
    const candidates = records.filter((record) =>
      mobileAccountOwnersEqual(record, input.owner) &&
      !retained.has(record.localId) &&
      timerEntryIdCorrelationAgeMs(record, nowMs) > TIMER_ENTRY_ID_CORRELATION_MAX_AGE_MS
    );
    let removed = new Set<string>();
    if (candidates.length > 0) {
      const referenced = await timerEntryIdsReferencedByDurableWork(input.owner);
      removed = new Set(candidates.map((record) => record.localId).filter((localId) => !referenced.has(localId)));
      if (removed.size > 0) {
        // Checked again as late as possible, so a command admitted during the first scan keeps its mapping.
        const latest = await timerEntryIdsReferencedByDurableWork(input.owner);
        for (const localId of latest) removed.delete(localId);
      }
    }
    if (removed.size === 0 && !stamped) return [];
    await writeAllTimerEntryIdCorrelations(records.filter((record) =>
      !mobileAccountOwnersEqual(record, input.owner) || !removed.has(record.localId)
    ));
    return [...removed];
  });
}

function timerEntryIdCorrelationAgeMs(record: TimerEntryIdCorrelationRecord, nowMs: number) {
  const recordedAtMs = record.recordedAt ? Date.parse(record.recordedAt) : Number.NaN;
  return Number.isFinite(recordedAtMs) ? nowMs - recordedAtMs : 0;
}

async function timerEntryIdsReferencedByDurableWork(owner: MobileAccountOwner) {
  const { readPendingTimeEntryCommands, readRefusedStartFenceEntryIds } = await import("./timeEntryOutbox");
  const [queue, commands, stops, fenced] = await Promise.all([
    readQueue(owner),
    readPendingTimeEntryCommands(owner),
    readPendingTimerStops(),
    readRefusedStartFenceEntryIds(owner)
  ]);
  const referenced = new Set<string>(fenced);
  for (const item of queue) {
    referenced.add(item.localId);
    // A queued event may name a block by its local ID in its payload (a Stop's target, say).
    for (const value of Object.values(item.rawPayload ?? {})) {
      if (typeof value === "string") referenced.add(value);
    }
  }
  for (const command of commands) {
    if (command.optimisticEntryId) referenced.add(command.optimisticEntryId);
  }
  for (const stop of stops) {
    if (stop.optimisticEntryId && timerStopOwnerMatches(stop, owner)) referenced.add(stop.optimisticEntryId);
  }
  return referenced;
}

export type StorageQuarantineDiagnostics = {
  count: number;
  /**
   * Reason, time and size only: a quarantined blob's contents never leave the iPhone. `contentsKept`
   * is false once they were deleted (after 7 days, or when the account changed).
   */
  records: Array<{
    container: StorageQuarantineContainer;
    quarantinedAt: string;
    reason: string;
    byteLength: number;
    contentsKept: boolean;
    removedAt: string | null;
    removal: StorageQuarantineRemoval | null;
  }>;
};

/** For Sync help's support details: queue and correlation containers that could not be read. */
export async function getStorageQuarantineDiagnostics(): Promise<StorageQuarantineDiagnostics> {
  const records = await sweepStorageQuarantine();
  return {
    count: records.length,
    records: records.map((record) => ({
      container: record.container,
      quarantinedAt: record.quarantinedAt,
      reason: record.reason,
      byteLength: record.byteLength,
      contentsKept: record.raw !== undefined,
      removedAt: record.removedAt ?? null,
      removal: record.removal ?? null
    }))
  };
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
      // Only the timer lane can record a correlation; a slow Health or location upload is not waited for.
      pendingSync: owner
        ? activityQueueSyncInFlightByLane.get(activityQueueLaneKey(owner, "timer"))?.promise ?? null
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
        !queuedEventMatchesOwner(item, owner) ||
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
    const target = all.find((item) => queuedEventMatchesOwner(item, owner) && item.localId === localId);
    if (!target) return false;
    // A refused Start leaves only once what waits on it is settled (Codex r2 on #532).
    if (isRefusedTimerStart(target) && !await settleRefusedTimerStart(refusedTimerStartOf(target, owner))) {
      return false;
    }
    await settleDiscardedHealthEvents([target]);
    await writeAllQueue(all.filter((item) => item !== target));
    return true;
  });
}

/**
 * A Health event the person removes from the queue is settled in its Health journal first
 * (`discarded`), so its payload and episode stop being protected as unsettled work (Codex r1 on #549).
 * A failure leaves the queue unchanged; Clear can be tried again.
 */
async function settleDiscardedHealthEvents(items: QueuedEvent[]) {
  const health = items.filter((item) =>
    item.healthOwner && (item.source === "health_sleep" || item.source === "health_workout"));
  if (!health.length) return;
  const { discardQueuedHealthDeliveries } = await import("./healthSyncStore");
  await discardQueuedHealthDeliveries(health.map((item) => ({ owner: item.healthOwner!, clientEventId: item.localId })));
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
    parkedFailedCount: permanentFailed.filter(isParkedNonTimerEvent).length,
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
      return { removed: [], remaining: [], removedCount: 0, remainingCount: 0, heldCount: 0 };
    }
    const all = await readAllQueue(owner);
    const queue = all.filter((item) => queuedEventMatchesOwner(item, owner));
    // A refused Start leaves only once its Stops are removed and its Edits and Deletes settled; if
    // that storage write fails it stays (and the next pass or Clear settles it), so its Edit can never
    // be left waiting for a block that was never saved (Codex r2 on #532).
    const held = new Set<QueuedEvent>();
    for (const item of queue) {
      if (!isClearableFailedEvent(item) || !isRefusedTimerStart(item)) continue;
      if (!await settleRefusedTimerStart(refusedTimerStartOf(item, owner))) held.add(item);
    }
    const remaining = queue.filter((item) => !isClearableFailedEvent(item) || held.has(item));
    const removed = queue.filter((item) => isClearableFailedEvent(item) && !held.has(item));
    await settleDiscardedHealthEvents(removed);
    await writeAllQueue([
      ...all.filter((item) => !queuedEventMatchesOwner(item, owner)),
      ...remaining
    ]);
    return {
      removed,
      remaining,
      removedCount: removed.length,
      remainingCount: remaining.length,
      heldCount: held.size
    };
  });
}

export function syncQueue(options: SyncQueueOptions = {}): Promise<SyncQueueResult> {
  return withJsTask("sync-queue", () => syncQueueNow(options));
}

async function syncQueueNow(options: SyncQueueOptions): Promise<SyncQueueResult> {
  const scope = options.eventScope ?? "all";
  const first = await withQueueMutation(async () => {
    const owner = await readActiveMobileAccount();
    if (!owner) return null;
    const lane: ActivityQueueLane = scope === "non_timer" || scope === "health" ? "non_timer" : "timer";
    const phase = scope === "all" ? { ...options, eventScope: "timer_mutations" as const } : options;
    return { owner, sync: chainActivityQueueLaneSync(owner, lane, phase) };
  });
  if (!first) return queueSyncResult([], [], undefined, false);
  if (scope !== "all") return first.sync;

  // Timer events first, then the rest on its own lane: a later timer sync never waits for this half.
  const { owner } = first;
  const timerResult = await first.sync;
  if (options.signal?.aborted || timerResult.stopped) {
    return combineQueueSyncResults(
      [timerResult],
      await ownedQueueForScope(owner, "all"),
      options.signal?.aborted === true
    );
  }
  const foreground = await withQueueMutation(async () =>
    ({ sync: chainActivityQueueLaneSync(owner, "non_timer", { ...options, eventScope: "non_timer" }) })
  );
  const foregroundResult = await foreground.sync;
  return combineQueueSyncResults(
    [timerResult, foregroundResult],
    await ownedQueueForScope(owner, "all")
  );
}

/** Chains one pass behind the owner's earlier pass on the same lane. Call inside `withQueueMutation`. */
function chainActivityQueueLaneSync(
  owner: MobileAccountOwner,
  lane: ActivityQueueLane,
  options: SyncQueueOptions
) {
  const laneKey = activityQueueLaneKey(owner, lane);
  const previous = activityQueueSyncInFlightByLane.get(laneKey)?.promise;
  const active: ActiveActivityQueueSync = { promise: Promise.resolve(
    queueSyncResult([], [], undefined, false)
  ) };
  const nextSync = (previous?.catch(() => undefined) ?? Promise.resolve())
    .then(() => runActivityQueueSyncRequest(options, owner))
    .finally(() => {
      if (activityQueueSyncInFlightByLane.get(laneKey) === active) {
        activityQueueSyncInFlightByLane.delete(laneKey);
      }
    });
  active.promise = nextSync;
  activityQueueSyncInFlightByLane.set(laneKey, active);
  return nextSync;
}

function activityQueueLaneKey(owner: MobileAccountOwner, lane: ActivityQueueLane) {
  return `${lane}:${mobileAccountKey(owner)}`;
}

async function runActivityQueueSyncRequest(
  options: SyncQueueOptions,
  owner: MobileAccountOwner
) {
  if (options.eventScope === "health") {
    // Never alongside timer delivery's background assertion; the next wake or foreground sends it.
    if (getTimerBackgroundExecutionSnapshot().activeLeaseCount > 0) {
      return deferredQueueSyncResult(owner, "health");
    }
    return syncQueueUnlocked(options, owner);
  }
  if (options.eventScope === "non_timer") {
    if (
      getTimerBackgroundExecutionSnapshot().activeLeaseCount > 0 ||
      !foregroundActivitySyncAllowed()
    ) {
      return deferredQueueSyncResult(owner, "non_timer");
    }
    return syncQueueUnlocked(options, owner);
  }
  return syncQueueUnlocked({ ...options, eventScope: "timer_mutations" }, owner);
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
    queuedEventMatchesOwner(item, owner) && queueEventMatchesScope(item, scope)
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
    queuedEventMatchesOwner(item, owner) && queueEventMatchesScope(item, options.eventScope)
  );
  const hasDeliverableTimerMutation = queue.some((item) =>
    isQueuedTimerMutationEvent(item) && item.failureKind !== "permanent"
  );
  if (options.eventScope !== "non_timer" && options.eventScope !== "health") {
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
  const refusedStarts: RefusedTimerStart[] = [];
  const dropped: string[] = [];
  let firstError: QueueFailureReport | undefined;
  let stopped = false;
  const now = new Date();
  // At most one slow retry of a parked Health or location event per pass (see isParkedRetryDue).
  let parkedRetryBudget = 1;

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (options.signal?.aborted) {
      remaining.push(item, ...queue.slice(index + 1));
      stopped = true;
      break;
    }
    // A journal-owned Health event whose delivery is no longer owed (discarded, acknowledged or gone
    // with its account's journal) leaves the queue unsent (Codex r3 on #549).
    if (item.healthOwner && item.localId.startsWith("healthkit:") && queuedEventMatchesOwner(item, owner)) {
      const { isHealthDeliveryOpen } = await import("./healthSyncStore");
      // A journal that cannot be read now keeps the event: only a settled or missing row drops it.
      if (!await isHealthDeliveryOpen(item.healthOwner, item.localId).catch(() => true)) {
        dropped.push(item.localId);
        continue;
      }
    }
    if (options.onlyFailed && !hasQueueFailure(item)) {
      remaining.push(item);
      continue;
    }
    const parkedRetry = !options.retryFailed && parkedRetryBudget > 0 && isParkedRetryDue(item, now);
    if (parkedRetry) parkedRetryBudget -= 1;
    if (!options.retryFailed && !parkedRetry && isPermanentlyFailedEvent(item)) {
      remaining.push(item);
      firstError ??= queueFailureReport(
        item,
        item.lastError ?? "Queued event is marked invalid.",
        item.failureKind ?? "permanent",
        item.lastStatusCode
      );
      continue;
    }
    // Timer events keep strict order (a Stop waits for its Start). Health and location events are
    // independent, idempotent summaries, so one that is failing never holds back the next (stability
    // audit 22 Oct 2026, iphone-timer-sync-4).
    const isolated = !isQueuedTimerMutationEvent(item);
    if (hasQueueFailure(item) && !options.retryFailed && !options.forceRetry && !isQueueRetryDue(item, now)) {
      firstError ??= queueFailureReport(
        item,
        `Next retry ${formatRetryIso(item.nextRetryAt)}.`,
        item.failureKind ?? "network",
        item.lastStatusCode
      );
      if (isolated) {
        remaining.push(item);
        continue;
      }
      remaining.push(item, ...queue.slice(index + 1));
      stopped = true;
      break;
    }

    const attemptedAt = new Date().toISOString();
    try {
      if (!queuedEventMatchesOwner(item,owner)) throw new StaleMobileSessionResponseError();
      const sessionRead = await readOwnedAuthenticatedSessionSnapshot(owner);
      if (sessionRead.status !== "authenticated") {
        remaining.push(item, ...queue.slice(index + 1));
        stopped = true;
        break;
      }
      const {response,body:payload} = await mobileJsonRequest<Record<string,unknown> | null>(
        `${DAYFRAME_API_BASE}/api/events`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionRead.snapshot.token}`,
            // The reply's Review count counts cards, an outing once (PR 12c).
            [REVIEW_COUNT_REQUEST_HEADER]: REVIEW_COUNT_CARDS
          },
          body: JSON.stringify(queuedEventRequestBody(item)),
          signal: options.signal
        },
        {
          isCurrent: async () => queuedEventMatchesOwner(item,owner) && isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot) && mobileAccountOwnersEqual(await readActiveMobileAccount(),owner),
          timeoutMilliseconds: MOBILE_QUEUE_REQUEST_TIMEOUT_MS,
          timeoutMessage: "Queued activity sync timed out. It will retry automatically."
        }
      );
      if (response.status === 401 || response.status === 403) {
        throw new AuthRequiredError();
      }
      if (
        !queuedEventMatchesOwner(item,owner) ||
        !isAuthenticatedSessionSnapshotCurrent(sessionRead.snapshot) ||
        !mobileAccountOwnersEqual(await readActiveMobileAccount(), owner)
      ) {
        remaining.push(item, ...queue.slice(index + 1));
        stopped = true;
        break;
      }
      if (!response.ok) {
        const message = formatApiError((payload ?? {}) as ApiErrorPayload) ?? "Unable to sync queued event";
        if (isolated && !permanentStatusCodes.has(response.status)) {
          const failedItem = markNonTimerServerFailure(item, message, attemptedAt, response.status);
          remaining.push(failedItem);
          firstError ??= queueFailureReport(failedItem, failedItem.lastError ?? message, failedItem.failureKind ?? "server", response.status);
          continue;
        }
        const failureKind = permanentStatusCodes.has(response.status) ? "permanent" : "server";
        // Only a Start refused for the first time is announced: Sync help's Retry of one already refused
        // is refused again, and the person was already told (Codex r2 on #532). The refusal is kept on
        // the item, so a transient failure between Retries (422, 500, 422) can't announce it twice
        // (Codex r3 on #532).
        const refusedStart = failureKind === "permanent" && item.type === "timer_start";
        const firstRefusal = refusedStart && !item.refusedStartAt && !isPermanentlyFailedEvent(item);
        const failedItem = {
          ...markQueueFailure(item, message, attemptedAt, failureKind, response.status),
          ...(refusedStart && !item.refusedStartAt ? { refusedStartAt: attemptedAt } : {})
        };
        remaining.push(failedItem);
        firstError ??= queueFailureReport(failedItem, message, failureKind, response.status);
        if (firstRefusal) {
          refusedStarts.push({ localId: item.localId, message, owner });
        }
        if (failureKind !== "permanent") {
          remaining.push(...queue.slice(index + 1));
          stopped = true;
          break;
        }
        continue;
      }
      if (!payload || typeof payload.eventId !== "string" || !payload.eventId.trim() || payload.ok === false || payload.partial === true ||
          payload.clientEventId !== undefined && payload.clientEventId !== item.localId) {
        throw new InvalidMobileAcknowledgementError();
      }
      if (item.type === "timer_start") {
        if (typeof payload.timeEntryId !== "string" || !payload.timeEntryId) {
          throw new Error("The server didn't return the started block.");
        }
        await recordTimerEntryIdCorrelation(item.localId, payload.timeEntryId, owner);
        timerEntryIdCorrelations.push({
          localId: item.localId,
          timeEntryId: payload.timeEntryId
        });
      }
      if (item.source === "health_sleep" || item.source === "health_workout") {
        if (item.healthOwner && queuedEventMatchesOwner(item,owner)) {
          const { recordHealthAcknowledgement } = await import("./healthSyncStore");
          await recordHealthAcknowledgement(item.healthOwner,item.localId,{
            eventId:payload.eventId,clientEventId:item.localId,
            processingDisposition:typeof payload.processingDisposition === "string" ? payload.processingDisposition : "legacy_unknown",
            reviewItemId:typeof payload.reviewItemId === "string" ? payload.reviewItemId : null,
            timeEntryId:typeof payload.timeEntryId === "string" ? payload.timeEntryId : null
          });
        } else if (item.localId.startsWith("healthkit:")) {
          throw new Error("The Health acknowledgement backend is not verified.");
        }
      }
      noteReviewCountQuietly(owner, (payload as { reviewCount?: unknown }).reviewCount);
      synced.push(item.localId);
    } catch (error) {
      if (error instanceof AuthRequiredError) throw error;
      if (error instanceof StaleMobileSessionResponseError || options.signal?.aborted || error instanceof Error && error.name === "AbortError") {
        remaining.push(item,...queue.slice(index+1));stopped=true;break;
      }
      const message = error instanceof Error ? error.message : "Network request failed";
      const failureKind = isMobileTransportFailure(error) ? "network" : "server";
      const failedItem = keepParked(item, markQueueFailure(item, message, attemptedAt, failureKind));
      firstError ??= queueFailureReport(failedItem, message, failedItem.failureKind ?? failureKind);
      if (isolated && failureKind === "server") {
        remaining.push(failedItem);
        continue;
      }
      remaining.push(failedItem, ...queue.slice(index + 1));
      stopped = true;
      break;
    }
  }

  const reconciledRemaining = await reconcileActivityQueueDrain({
    owner,
    processed: queue,
    remaining,
    synced: [...synced, ...dropped]
  });
  // Every refused Start still in the queue is settled on every pass (idempotent), so a storage failure
  // is retried; only the newly refused are announced (Codex r1 on #532).
  const stillRefused = reconciledRemaining.filter((item) =>
    isRefusedTimerStart(item) && queuedEventMatchesOwner(item, owner)
  );
  if (stillRefused.length || refusedStarts.length) {
    await settleRefusedTimerStarts(
      stillRefused.map((item) => refusedTimerStartOf(item, owner)),
      new Set(refusedStarts.map((start) => start.localId))
    );
  }
  return queueSyncResult(
    synced,
    reconciledRemaining.filter((item) => queueEventMatchesScope(item, options.eventScope)),
    firstError,
    stopped,
    timerEntryIdCorrelations
  );
}

export type RefusedTimerStart = { localId: string; message: string; owner: MobileAccountOwner };

const refusedTimerStartListeners = new Set<(start: RefusedTimerStart) => void>();

/** Told once when the server permanently refuses a queued Start (its block is never created). */
export function subscribeRefusedTimerStarts(listener: (start: RefusedTimerStart) => void) {
  refusedTimerStartListeners.add(listener);
  return () => {
    refusedTimerStartListeners.delete(listener);
  };
}

/**
 * A queued Start the server refused never gets a block, so what waits on it can never be delivered: its
 * Stops are removed, its Edits and Deletes become sync issues the person can see and discard, and the
 * Dashboard rolls the block back (stability audit 22 Oct 2026, iphone-timer-sync-3: the rollback had had
 * no caller since 22 Aug, and one such Edit held the account's whole Edit/Delete outbox).
 */
async function settleRefusedTimerStarts(refused: readonly RefusedTimerStart[], newlyRefused: ReadonlySet<string>) {
  for (const start of refused) {
    // Storage failed: the Start stays queued, so the next pass (or a Clear) settles it again.
    await settleRefusedTimerStart(start);
    if (!newlyRefused.has(start.localId)) continue;
    for (const listener of refusedTimerStartListeners) {
      try {
        listener(start);
      } catch {
        // A listener's failure never stops the others or the sync pass.
      }
    }
  }
}

/** Removes a refused Start's Stops and settles its Edits and Deletes; false when storage failed. */
async function settleRefusedTimerStart(start: RefusedTimerStart) {
  try {
    const [{ removePendingTimerStopsForTarget }, { refuseTimeEntryCommandsForOptimisticEntry }] = await Promise.all([
      import("./timerStopOutbox"),
      import("./timeEntryOutbox")
    ]);
    await removePendingTimerStopsForTarget(start.owner, { optimisticEntryId: start.localId });
    // Also fences the block's ID, so an Edit or Delete written for it later is refused as it is
    // written, even after Clear has removed the Start (Codex r3 on #532).
    await refuseTimeEntryCommandsForOptimisticEntry(start.owner, start.localId);
    return true;
  } catch {
    return false;
  }
}

function isRefusedTimerStart(item: QueuedEvent) {
  return item.type === "timer_start" && isPermanentlyFailedEvent(item);
}

function refusedTimerStartOf(item: QueuedEvent, owner: MobileAccountOwner): RefusedTimerStart {
  return { localId: item.localId, message: item.lastError ?? "", owner };
}

function queueEventMatchesScope(
  event: Pick<QueuedEvent, "type" | "source">,
  scope: SyncQueueOptions["eventScope"] = "all"
) {
  if (scope === "timer_mutations") return isQueuedTimerMutationEvent(event);
  if (scope === "health") return event.source === "health_sleep" || event.source === "health_workout";
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

    const message = await errorMessage(response, "Couldn't sync the Stop");
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
  if (!response.ok) throw await apiResponseError(response, "Couldn't delete the block");
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
  if (!response.ok) throw await apiResponseError(response, "Couldn't update the block");
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
  if (!response.ok) throw await apiResponseError(response, "Couldn't add the block");
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
  if (!response.ok) throw await apiResponseError(response, "Unable to update review item");
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
  if (!response.ok) throw await apiResponseError(response, "Unable to update location review");
  return readJsonResponse(response);
}

export async function fetchLocationReviewEvidence(
  id: string,
  options: { signal?: AbortSignal; owner?: MobileAccountOwner } = {}
): Promise<LocationReviewEvidenceDto> {
  // With an owner, the read goes only under that account's own session: evidence cached and shown
  // for one account is never read with another's bearer during an account handover (Codex r3 on #522).
  const session = options.owner
    ? await readOwnedAuthenticatedSessionSnapshot(options.owner)
    : await readAuthenticatedSessionSnapshot();
  if (session.status === "changed" || session.status === "owner_mismatch") throw new StaleMobileSessionResponseError();
  if (session.status !== "authenticated") throw new AuthRequiredError();
  const { response, body } = await mobileJsonRequest<LocationReviewEvidenceDto | null>(
    `${DAYFRAME_API_BASE}/api/review/${encodeURIComponent(id)}/location-evidence`,
    { headers: { Authorization: `Bearer ${session.snapshot.token}` }, cache: "no-store", signal: options.signal },
    { timeoutMilliseconds: MOBILE_LOCATION_REVIEW_EVIDENCE_TIMEOUT_MS,
      timeoutMessage: "Location evidence is taking too long to load.",
      isCurrent: () => isAuthenticatedSessionSnapshotCurrent(session.snapshot),
      validate: (body, response) => response.ok ? LocationReviewEvidenceDtoSchema.parse(body) : null }
  );
  if (response.status === 401 || response.status === 403) throw new AuthRequiredError();
  if (!response.ok) throw new MobileHttpResponseError(response.status, "Unable to load location evidence");
  if (!body) throw new InvalidMobileAcknowledgementError();
  return body;
}

/**
 * Tell the server which Apple venue the ranker was confident about for an open card's unsaved stay
 * (location v3 PR 8, design §6.3): its Place ID only. Best effort and foreground only, while
 * Location evidence is on screen; any failure (offline, a decided card) is dropped quietly, since
 * the suggestion is recomputed the next time the stay is opened. Sent only under the session of
 * `owner`, the account the evidence was read for, and only while the app is active, both checked
 * again right before the request starts (Codex r1 on #522).
 */
export async function reportVenueSuggestion(reviewItemId: string, placeId: string, owner: MobileAccountOwner): Promise<boolean> {
  try {
    if (AppState.currentState !== "active") return false;
    const session = await readOwnedAuthenticatedSessionSnapshot(owner);
    if (session.status !== "authenticated") return false;
    if (AppState.currentState !== "active" || !isAuthenticatedSessionSnapshotCurrent(session.snapshot)) return false;
    const { response } = await mobileJsonRequest<null>(
      `${DAYFRAME_API_BASE}/api/review/${encodeURIComponent(reviewItemId)}/venue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.snapshot.token}` },
        body: JSON.stringify({ placeId })
      },
      {
        timeoutMilliseconds: MOBILE_LOCATION_REVIEW_EVIDENCE_TIMEOUT_MS,
        timeoutMessage: "Saving the suggested place took too long.",
        isCurrent: () => isAuthenticatedSessionSnapshotCurrent(session.snapshot),
        handleAuthentication: false,
        validate: () => null
      }
    );
    return response.ok;
  } catch {
    return false;
  }
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
  if (!response.ok) throw await apiResponseError(response, "Unable to delete recent location evidence");
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
  options: { limit?: number; force?: boolean; mappings?: HealthAutoLogMappings; cursor?: string | null; signal?: AbortSignal; deadlineAt?: number } = {}
): Promise<HealthReviewReprocessResult> {
  const session = await readAuthenticatedSessionSnapshot();
  if(session.status!=="authenticated") throw new AuthRequiredError();
  const {response,body} = await mobileJsonRequest<Record<string,unknown> | null>(`${DAYFRAME_API_BASE}/api/review/reprocess-health`, {
    method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.snapshot.token}`},signal:options.signal,
    body:JSON.stringify({preferences,limit:options.limit,force:options.force,mappings:options.mappings,cursor:options.cursor})
  }, {timeoutMilliseconds:Math.max(1,Math.min(15_000,(options.deadlineAt??Date.now()+15_000)-Date.now())),timeoutMessage:"Health processing timed out. Captured activity remains saved.",
    isCurrent:()=>isAuthenticatedSessionSnapshotCurrent(session.snapshot)});
  if(response.status===401||response.status===403) throw new AuthRequiredError();
  if(!response.ok) throw new MobileHttpResponseError(response.status,typeof body?.message==="string"?body.message:"Unable to reprocess Health review items");
  if(!body || typeof body.checkedCount!=="number" || body.ok===false) throw new InvalidMobileAcknowledgementError();
  return body as unknown as HealthReviewReprocessResult;
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
  if (!response.ok) throw await apiResponseError(response, "Unable to save reviewed activity");
  return readJsonResponse(response);
}

export async function createCategory(
  name: string,
  options: { color?: string; isPinned?: boolean; icon?: string | null; countsTowardGoal?: boolean } = {}
): Promise<MobileCategoryResponse> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/categories`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    // Without a chosen colour the server picks the name's automatic palette colour (as on the web).
    body: JSON.stringify({
      name,
      ...(options.color ? { color: options.color } : {}),
      // An icon key from the shared set; left out, the name decides the icon.
      ...(options.icon !== undefined ? { icon: options.icon } : {}),
      // Left out, the server counts a new activity toward the goal.
      ...(options.countsTowardGoal !== undefined ? { countsTowardGoal: options.countsTowardGoal } : {}),
      isPinned: Boolean(options.isPinned)
    })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (response.status === 409) throw new ActivityNameTakenError(await errorMessage(response, "An activity with that name already exists."));
  if (!response.ok) throw await apiResponseError(response, "Unable to create activity");
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
  if (!response.ok) throw await apiResponseError(response, "Unable to create tag");
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
    throw await apiResponseError(response, "Unable to prepare automatic logging activities");
  }
  const payload = await readJsonResponse<{ categories: MobileCategoryResponse[] }>(response);
  return payload.categories;
}

export async function updateCategory(
  id: string,
  options: { name?: string; color?: string; isPinned?: boolean; icon?: string | null; countsTowardGoal?: boolean }
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
  if (!response.ok) throw await apiResponseError(response, "Unable to update activity");
  return readJsonResponse(response);
}

/** Settings › Your day: the daily and weekly goals (stored on the account, shared with the web). */
export async function updateTimeGoals(goals: { dailyGoalMinutes?: number; weeklyGoalMinutes?: number }) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify(goals)
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw await apiResponseError(response, "Unable to save your goal");
}

/**
 * Settings › Automatic tracking › "Log trips automatically" (PRD D19, A4). Returns the stored value
 * and its server revision (null from a server without one).
 */
export async function updateLogTripsAutomatically(enabled: boolean, expectedUserId?: string) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ logTripsAutomatically: enabled, ...(expectedUserId ? { expectedUserId } : {}) })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw await apiResponseError(response, "Unable to save this setting");
  const body = await readJsonResponse<{ logTripsAutomatically?: unknown; settingsRevision?: unknown }>(response);
  return {
    value: typeof body.logTripsAutomatically === "boolean" ? body.logTripsAutomatically : enabled,
    revision: typeof body.settingsRevision === "number" ? body.settingsRevision : null
  };
}

/** A trip pattern the person stopped logging automatically (Places › Trips, PRD D19 A4). */
export type StoppedTrip = { patternKey: string; label: string; stoppedAt: string };

/** "Don't log trips like this": stops the pattern of the Move a deleted automatic block came from. */
export async function stopLoggingTripsLike(eventId: string) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/location/name-patterns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ action: "stop_trips", eventId })
  });
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) throw await apiResponseError(response, "Unable to stop logging trips like this");
}

/** Places › Trips: the trips the person stopped logging automatically. */
export async function listStoppedTrips(): Promise<StoppedTrip[]> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/location/name-patterns`, { headers: await authHeaders() });
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) throw await apiResponseError(response, "Unable to load trips");
  const body = await readJsonResponse<{ trips?: StoppedTrip[] }>(response);
  return body.trips ?? [];
}

/** Places › Trips: "Log automatically again". */
export async function resumeLoggingTrips(patternKey: string) {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/location/name-patterns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ action: "resume_trips", patternKey })
  });
  if (response.status === 401) throw new AuthRequiredError();
  if (!response.ok) throw await apiResponseError(response, "Unable to change this trip");
}

/** Settings › Activities › Archived (Blocks 6b-2): the workspace's archived activities. */
export async function listArchivedCategories(): Promise<MobileBootstrap["categories"]> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/categories?archived=1`, {
    headers: await authHeaders()
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw await apiResponseError(response, "Unable to load archived activities");
  const body = await readJsonResponse<{ categories: MobileBootstrap["categories"] }>(response);
  return body.categories;
}

/** Restores an archived activity (unpinned; a name now taken by another activity is refused). */
export async function restoreCategory(id: string): Promise<MobileCategoryResponse> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/categories`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ id, isArchived: false })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw await apiResponseError(response, "Unable to restore the activity");
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
  if (!response.ok) throw await apiResponseError(response, "Unable to delete activity");
  return readJsonResponse(response);
}

export type NewPlaceRole = {
  role: PlaceRole;
  previousPlaceName?: string | null;
  /** "Replace the old place" (PRD D19 A10): archive the old holder when it is within 300 m. */
  archivePrevious?: boolean;
};

/**
 * Creates a place in one request that returns it, so an accepted save never depends on a later
 * read (a retry after a failed follow-up read would add the place twice).
 */
export async function createPlace(input: { name: string } & PlaceMutationInput, newRole?: NewPlaceRole) {
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
      // Log automatically (owner decision 14 Oct 2026): only with logging on (Codex r1 on #434).
      autoLog: input.loggingEnabled !== false && input.autoLog === true,
      ...(input.learnedPlaceId ? { learnedPlaceId: input.learnedPlaceId } : {}),
      // Added straight into the Home or Work slot, renaming (or archiving) the old holder if asked.
      ...(newRole ? {
        role: newRole.role,
        previousPlaceName: newRole.previousPlaceName ?? null,
        ...(newRole.archivePrevious ? { archivePrevious: true } : {})
      } : {})
    })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  const fallback = input.learnedPlaceId ? "Unable to save learned place" : "Unable to save place";
  if (!response.ok) throw await apiResponseError(response, fallback);
  return readPlaceResponse(response, fallback);
}

/**
 * Moves the Home or Work role to `placeId` (null empties the slot); past entries never move.
 * `archivePrevious` ("Replace the old place", PRD D19 A10) archives the old holder in the same step
 * when the server finds it within 300 m of the new place; `previousArchived` says whether it did.
 */
export async function setPlaceRole(input: {
  role: PlaceRole;
  placeId: string | null;
  previousPlaceName: string | null;
  archivePrevious?: boolean;
}) {
  const { archivePrevious, ...request } = input;
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/places/role`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify(archivePrevious ? { ...request, archivePrevious: true } : request)
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw await apiResponseError(response, "Unable to update this place");
  const result = await readApiJson<{
    role: PlaceRole;
    placeId: string | null;
    previousPlaceId: string | null;
    previousArchived?: boolean;
  }>(
    response,
    "Unable to update this place"
  );
  if (!result.ok) throw new Error(result.message);
  return result.payload;
}

/** An archived place (PRD D19 A10): out of every list and matcher, its history kept, restorable. */
export type MobileArchivedPlace = { id: string; name: string; archivedAt: string };

/** Places › Archived: the workspace's archived places, newest first. */
export async function fetchArchivedPlaces(): Promise<MobileArchivedPlace[]> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/places/archive`, {
    headers: await authHeaders()
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw await apiResponseError(response, "Unable to load archived places");
  const result = await readApiJson<{ places?: MobileArchivedPlace[] }>(response, "Unable to load archived places");
  if (!result.ok) throw new Error(result.message);
  return result.payload.places ?? [];
}

/**
 * Places' last visit and sections (location v3 PR 16c): the person's last visit and visits in the
 * last 30 days for each active saved place. Times and counts only; a failure only means the rows
 * show no visit line.
 */
export async function fetchPlaceVisits(): Promise<PlaceVisitStats[]> {
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/places/visits`, {
    headers: await authHeaders()
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw await apiResponseError(response, "Unable to load place visits");
  const result = await readApiJson<{ visits?: PlaceVisitStats[] }>(response, "Unable to load place visits");
  if (!result.ok) throw new Error(result.message);
  return (result.payload.visits ?? []).filter((row) =>
    typeof row?.placeId === "string" && (row.lastVisitAt === null || typeof row.lastVisitAt === "string") &&
    Number.isFinite(row.visitsLast30Days));
}

/**
 * Archives (true) or restores (false) a place. Archiving clears its Home/Work role; restoring brings
 * it back without one. A busy place (409) or a missing one (404) says why in the server's words.
 */
export async function setPlaceArchived(id: string, archived: boolean) {
  const fallback = archived ? "Unable to archive this place" : "Unable to restore this place";
  const response = await mobileFetch(`${DAYFRAME_API_BASE}/api/places/archive`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ id, archived })
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) throw await apiResponseError(response, fallback);
  const result = await readApiJson<{ ok?: boolean; place?: { id: string; name: string; archivedAt: string | null } }>(
    response,
    fallback
  );
  if (!result.ok) throw new Error(result.message);
  if (!result.payload.place || result.payload.place.id !== id) throw new Error(fallback);
  return result.payload.place;
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
  if (!response.ok) throw await apiResponseError(response, "Unable to ignore learned place");
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
  if (!response.ok) throw await apiResponseError(response, "Unable to resolve learned place");
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
  if (!response.ok) throw await apiResponseError(response, "Unable to forget learned place");
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
  if (!response.ok) throw await apiResponseError(response, "Unable to update place");
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
  if (!response.ok) throw await apiResponseError(response, "Unable to delete place");
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
    failureKind,
    serverFailureCount: typeof item.serverFailureCount === "number" && Number.isFinite(item.serverFailureCount)
      ? Math.max(0, Math.trunc(item.serverFailureCount))
      : undefined,
    firstServerFailureAt: validIsoString(item.firstServerFailureAt)
  };
}

function hasCanonicalStopTarget(rawPayload: unknown) {
  if (!isRecord(rawPayload)) return false;
  // A Shortcut Stop names its own time instead of an entry: the server stops only what was running then.
  if (rawPayload.stopScope === "running_at") return true;
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

/**
 * A Health or location event the server keeps answering with an error is retried with backoff, then
 * parked as a Sync help issue ("Couldn't be sent": Try again or Clear) once it has had
 * NON_TIMER_SERVER_FAILURE_CAP error replies over at least NON_TIMER_SERVER_FAILURE_WINDOW_MS. It is
 * never dropped on its own (only the person's Clear removes it). Offline attempts and timeouts don't
 * count: only replies from the server do. A parked event keeps its Sync help issue but is still retried slowly (PARKED_RETRY_INTERVAL_MS, one per pass,
 * only on passes that run anyway: parked work never schedules a wake), and leaves once one succeeds.
 */
const NON_TIMER_SERVER_FAILURE_CAP = 8;
const NON_TIMER_SERVER_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A parked event is still retried on passes that run anyway, at most once per this interval. */
const PARKED_RETRY_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Parked by the server-error cap (not refused as invalid), and its slow retry is due. */
function isParkedRetryDue(item: QueuedEvent, now: Date) {
  if (!isParkedNonTimerEvent(item)) return false;
  const lastAttempt = new Date(item.lastAttemptedAt ?? "").getTime();
  return Number.isNaN(lastAttempt) || now.getTime() - lastAttempt >= PARKED_RETRY_INTERVAL_MS;
}

/** Parked by the server-error cap, as opposed to refused as invalid (400/413/422). */
function isParkedNonTimerEvent(item: QueuedEvent) {
  return !isQueuedTimerMutationEvent(item) &&
    item.failureKind === "permanent" &&
    !(item.lastStatusCode !== undefined && permanentStatusCodes.has(item.lastStatusCode)) &&
    (item.serverFailureCount ?? 0) >= NON_TIMER_SERVER_FAILURE_CAP;
}

/**
 * A parked event's unsuccessful retry (offline, timeout, invalid acknowledgement) keeps it parked: its
 * Sync help issue stays and its next automatic retry is again six hours on (Codex r1 on #547).
 */
function keepParked(item: QueuedEvent, failed: QueuedEvent): QueuedEvent {
  if (!isParkedNonTimerEvent(item)) return failed;
  return { ...failed, failureKind: "permanent", nextRetryAt: undefined, lastStatusCode: item.lastStatusCode };
}

function markNonTimerServerFailure(
  item: QueuedEvent,
  message: string,
  attemptedAt: string,
  statusCode: number
): QueuedEvent {
  const serverFailureCount = (item.serverFailureCount ?? 0) + 1;
  const firstServerFailureAt = validIsoString(item.firstServerFailureAt) ?? attemptedAt;
  const elapsedMs = new Date(attemptedAt).getTime() - new Date(firstServerFailureAt).getTime();
  const parked = serverFailureCount >= NON_TIMER_SERVER_FAILURE_CAP &&
    elapsedMs >= NON_TIMER_SERVER_FAILURE_WINDOW_MS;
  return {
    ...markQueueFailure(
      item,
      parked ? `${message} Dayframe stopped retrying it after repeated server errors.` : message,
      attemptedAt,
      parked ? "permanent" : "server",
      statusCode
    ),
    serverFailureCount,
    firstServerFailureAt
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

/**
 * Every item Sync help shows as "Couldn't be sent" can be cleared, a parked Apple Health event too: Clear
 * settles its source-journal delivery as `discarded` before the queue write (`settleDiscardedHealthEvents`),
 * so it no longer counts as unsettled work, and if that settlement fails Clear fails with nothing removed.
 * A later source change of that episode is a new revision and is sent as usual.
 */
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
        !queuedEventMatchesOwner(item, input.owner) ||
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
        ...(processed.failureKind ? { failureKind: processed.failureKind } : {}),
        ...(processed.refusedStartAt ? { refusedStartAt: processed.refusedStartAt } : {}),
        ...(processed.serverFailureCount === undefined
          ? {}
          : { serverFailureCount: processed.serverFailureCount }),
        ...(processed.firstServerFailureAt ? { firstServerFailureAt: processed.firstServerFailureAt } : {})
      }];
    });
    await writeAllQueue(next);
    return next.filter((item) => queuedEventMatchesOwner(item, input.owner));
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

/**
 * `unlocked` readers (`readQueue`) never change an unreadable queue themselves: they schedule its
 * quarantine under the queue lock, so it cannot race a locked writer's fresh queue.
 */
async function readAllQueue(
  legacyOwner?: MobileAccountOwner,
  options: { unlocked?: boolean } = {}
): Promise<QueuedEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  let value: unknown;
  let unreadable: string | null = null;
  try {
    value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) unreadable = "The queue container was not an array.";
  } catch {
    unreadable = "The queue JSON could not be parsed.";
  }
  if (unreadable) {
    if (options.unlocked) {
      void withQueueMutation(() => readAllQueue(legacyOwner)).catch(() => undefined);
      return [];
    }
    // Kept before the queue starts again: if the copy cannot be written, this throws and nothing
    // is overwritten (stability audit 22 Oct 2026, iphone-timer-sync-12).
    await quarantineStorageContainer("activity_queue", raw, unreadable);
    await AsyncStorage.removeItem(QUEUE_KEY);
    for (const listener of activityQueueListeners) listener();
    return [];
  }
  const parsed = value as StoredQueuedEvent[];
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
  recordedAt?: string;
};

/**
 * The parsed container, keyed by its exact stored text: hot-path readers (every durable-work refresh,
 * Stop delivery and Edit) parse it once per change rather than on every read (iphone-timer-sync-7).
 * Readers never mutate the cached array.
 */
let timerEntryIdCorrelationCache: { raw: string; records: TimerEntryIdCorrelationRecord[] } | null = null;

/**
 * `forWrite` callers hold the correlation lock and are about to replace the container: an unreadable
 * one must be copied aside first, or they throw. Plain readers never change it.
 */
async function readAllTimerEntryIdCorrelations(
  legacyOwner?: MobileAccountOwner,
  options: { forWrite?: boolean } = {}
): Promise<TimerEntryIdCorrelationRecord[]> {
  const raw = await AsyncStorage.getItem(TIMER_ENTRY_ID_CORRELATIONS_KEY);
  if (!raw) return [];
  if (timerEntryIdCorrelationCache?.raw === raw) return timerEntryIdCorrelationCache.records;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // Copied aside before any writer replaces it (iphone-timer-sync-12): commands waiting on an
    // optimistic ID stay explainable.
    try {
      await quarantineStorageContainer(
        "timer_entry_id_correlations",
        raw,
        "The correlation JSON could not be parsed."
      );
    } catch (error) {
      if (options.forWrite) throw error;
      return [];
    }
    timerEntryIdCorrelationCache = { raw, records: [] };
    return [];
  }
  if (Array.isArray(parsed)) {
    const records = parsed.flatMap((value): TimerEntryIdCorrelationRecord[] => {
      if (!isRecord(value)) return [];
      const userId = optionalQueueOwnerText(value.userId);
      const workspaceId = optionalQueueOwnerText(value.workspaceId);
      const localId = optionalQueueOwnerText(value.localId);
      const timeEntryId = optionalQueueOwnerText(value.timeEntryId);
      const recordedAt = validIsoString(value.recordedAt);
      return userId && workspaceId && localId && timeEntryId
        ? [{ userId, workspaceId, localId, timeEntryId, ...(recordedAt ? { recordedAt } : {}) }]
        : [];
    });
    timerEntryIdCorrelationCache = { raw, records };
    return records;
  }
  if (!isRecord(parsed) || !legacyOwner) {
    // Valid JSON of a shape this build cannot read is kept aside like unparseable text (Codex r1 on #552).
    try {
      await quarantineStorageContainer(
        "timer_entry_id_correlations",
        raw,
        "The correlation container had an unsupported shape."
      );
    } catch (error) {
      if (options.forWrite) throw error;
      return [];
    }
    timerEntryIdCorrelationCache = { raw, records: [] };
    return [];
  }
  const migrated = Object.entries(parsed).flatMap(([localId, timeEntryId]) =>
    localId && typeof timeEntryId === "string" && timeEntryId
      ? [{ ...legacyOwner, localId, timeEntryId }]
      : []
  );
  await writeAllTimerEntryIdCorrelations(migrated);
  return migrated;
}

async function writeAllTimerEntryIdCorrelations(records: TimerEntryIdCorrelationRecord[]) {
  const raw = JSON.stringify(records);
  await AsyncStorage.setItem(TIMER_ENTRY_ID_CORRELATIONS_KEY, raw);
  timerEntryIdCorrelationCache = { raw, records };
}

type StorageQuarantineContainer = "activity_queue" | "timer_entry_id_correlations";
type StorageQuarantineRemoval = "expired" | "account_changed" | "logout";
type StorageQuarantineRecord = {
  container: StorageQuarantineContainer;
  quarantinedAt: string;
  reason: string;
  byteLength: number;
  /** The session authority's account when it was kept (null: signed out or undecided). */
  ownerKey: string | null;
  /** The launch that kept it: a copy without an account lives only for that launch. */
  launch: string;
  /** Absent once deleted; the record then stays as a note that a copy existed. */
  raw?: string;
  removedAt?: string;
  removal?: StorageQuarantineRemoval;
};

/** Every read-modify-write of the quarantine key runs here, whichever container is recovering. */
function withStorageQuarantineMutation<Result>(operation: () => Promise<Result>) {
  const result = storageQuarantineMutationTail.catch(() => undefined).then(operation);
  storageQuarantineMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

async function readStorageQuarantine(): Promise<StorageQuarantineRecord[]> {
  const raw = await AsyncStorage.getItem(STORAGE_QUARANTINE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): StorageQuarantineRecord[] => {
      if (!isRecord(value)) return [];
      const container = value.container === "activity_queue" || value.container === "timer_entry_id_correlations"
        ? value.container
        : null;
      const quarantinedAt = validIsoString(value.quarantinedAt);
      const reason = optionalQueueOwnerText(value.reason);
      const removal = value.removal === "expired" || value.removal === "account_changed" || value.removal === "logout"
        ? value.removal
        : undefined;
      const removedAt = validIsoString(value.removedAt);
      const contents = typeof value.raw === "string" ? value.raw : undefined;
      if (!container || !quarantinedAt || !reason || (contents === undefined && !removal)) return [];
      return [{
        container,
        quarantinedAt,
        reason,
        byteLength: typeof value.byteLength === "number" ? value.byteLength : contents?.length ?? 0,
        ownerKey: typeof value.ownerKey === "string" ? value.ownerKey : null,
        launch: typeof value.launch === "string" ? value.launch : "",
        ...(contents !== undefined ? { raw: contents } : {}),
        ...(removedAt ? { removedAt } : {}),
        ...(removal ? { removal } : {})
      }];
    });
  } catch {
    return [];
  }
}

/**
 * The account whose copies may keep their contents, from the session authority (as the Health journal
 * expiry decides, #549): null when signed out, undefined while undecided (a session change in flight,
 * an unreadable Keychain or an unbound legacy session), when only expiry applies.
 */
async function storageQuarantineKeeper(): Promise<{ ownerKey: string | null } | undefined> {
  let session: Awaited<ReturnType<typeof readAuthenticatedSessionSnapshot>>;
  try {
    session = await readAuthenticatedSessionSnapshot();
  } catch {
    return undefined;
  }
  if (session.status === "signed_out") return { ownerKey: null };
  if (session.status !== "authenticated" || !session.snapshot.owner) return undefined;
  return { ownerKey: mobileAccountKey(session.snapshot.owner) };
}

type StorageQuarantineRule = (record: StorageQuarantineRecord) => StorageQuarantineRemoval | null;

/** Deletes contents the rule (or the 7-day limit) removes, keeping a metadata note; bounds copies and notes. */
function retainStorageQuarantine(
  records: readonly StorageQuarantineRecord[],
  rule: StorageQuarantineRule,
  nowMs: number
) {
  const swept = records.map((record): StorageQuarantineRecord => {
    if (record.raw === undefined) return record;
    const removal = nowMs - Date.parse(record.quarantinedAt) > STORAGE_QUARANTINE_RAW_MAX_AGE_MS
      ? "expired"
      : rule(record);
    if (!removal) return record;
    const { raw: _raw, ...note } = record;
    return { ...note, removedAt: new Date(nowMs).toISOString(), removal };
  });
  const kept: StorageQuarantineRecord[] = [];
  const copies = new Map<StorageQuarantineContainer, number>();
  let notes = 0;
  for (const record of [...swept].reverse()) {
    if (record.raw !== undefined) {
      const count = copies.get(record.container) ?? 0;
      if (count >= STORAGE_QUARANTINE_MAX_PER_CONTAINER) continue;
      copies.set(record.container, count + 1);
    } else {
      if (notes >= STORAGE_QUARANTINE_MAX_NOTES) continue;
      notes += 1;
    }
    kept.unshift(record);
  }
  return kept;
}

/** Keeps contents only where the keeper owns them; a copy without an account only in its own launch. */
function storageQuarantineKeeperRule(keeper: { ownerKey: string | null } | undefined): StorageQuarantineRule {
  return (record) => {
    if (!keeper) return null;
    if (record.ownerKey === null) return record.launch === STORAGE_QUARANTINE_LAUNCH ? null : "account_changed";
    return record.ownerKey === keeper.ownerKey ? null : "account_changed";
  };
}

async function writeStorageQuarantine(records: readonly StorageQuarantineRecord[]) {
  if (records.length === 0) await AsyncStorage.removeItem(STORAGE_QUARANTINE_KEY);
  else await AsyncStorage.setItem(STORAGE_QUARANTINE_KEY, JSON.stringify(records));
}

/** The rule is built only when a copy exists, so the common empty case never reads the session. */
function updateStorageQuarantine(rule: () => Promise<StorageQuarantineRule> | StorageQuarantineRule) {
  return withStorageQuarantineMutation(async () => {
    const current = await readStorageQuarantine();
    if (current.length === 0) return current;
    const next = retainStorageQuarantine(current, await rule(), Date.now());
    if (JSON.stringify(next) !== JSON.stringify(current)) await writeStorageQuarantine(next);
    return next;
  });
}

/** Keeps the newest blobs per container; a blob already kept (a second reader of the same text) is not added twice. */
function quarantineStorageContainer(
  container: StorageQuarantineContainer,
  raw: string,
  reason: string
) {
  return withStorageQuarantineMutation(async () => {
    const keeper = await storageQuarantineKeeper();
    const current = await readStorageQuarantine();
    if (current.some((record) => record.container === container && record.raw === raw)) return;
    await writeStorageQuarantine(retainStorageQuarantine([
      ...current,
      {
        container,
        quarantinedAt: new Date().toISOString(),
        reason,
        byteLength: raw.length,
        ownerKey: keeper?.ownerKey ?? null,
        launch: STORAGE_QUARANTINE_LAUNCH,
        raw
      }
    ], storageQuarantineKeeperRule(keeper), Date.now()));
  });
}

/** Applies the retention rules for the session authority's account (launch, account changes, diagnostics, pruning). */
export function sweepStorageQuarantine() {
  return updateStorageQuarantine(async () => storageQuarantineKeeperRule(await storageQuarantineKeeper()));
}

/**
 * Deletes every copy's contents (logout, before it revokes the session) or every copy another account
 * owns (before a new account's session is installed). Awaited: a failure fails that logout or sign-in.
 */
function purgeStorageQuarantineContents(input: { keepOwner?: MobileAccountOwner; removal: StorageQuarantineRemoval }) {
  const keepKey = input.keepOwner ? mobileAccountKey(input.keepOwner) : undefined;
  return updateStorageQuarantine(() => (record) =>
    keepKey !== undefined && record.ownerKey === keepKey ? null : input.removal
  );
}

/** Account changes re-apply the rules; `app/_layout.tsx` also runs the sweep at every launch. */
export function watchStorageQuarantineAccountChanges() {
  return subscribeActiveMobileAccount(() => {
    void sweepStorageQuarantine().catch(() => undefined);
  });
}
watchStorageQuarantineAccountChanges();

function optionalQueueOwnerText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The server already has an active activity with this name (case-insensitive). */
export class ActivityNameTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityNameTakenError";
  }
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
  // Already plain words (UIA-320), so they are shown as they are.
  if (!response.ok) throw new MobileApiResponseError(response.status, plainAuthError(payload.error, response.status), true);
  if ("requiresEmailConfirmation" in payload) return payload;
  const owner = {
    userId: payload.user.id,
    workspaceId: payload.workspace.id
  };
  // Another account's quarantined contents go before this session is installed (Codex r2 on #552).
  await purgeStorageQuarantineContents({ keepOwner: owner, removal: "account_changed" });
  await setSessionToken(payload.token, owner);
  await activateMobileAccount(owner);
  await import("./location/runtime")
    .then(({ bindLocationCaptureOwner }) => bindLocationCaptureOwner(owner));
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
  if (!response.ok) throw await apiResponseError(response, "The block action failed");
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

/**
 * A failed reply as an error: the server's own sentence (from its JSON error body) when it gave
 * one, otherwise this call's fallback, marked so the iPhone shows only the server's words as they are.
 */
async function apiResponseError(response: Response, fallback: string) {
  const result = await readApiJson<ApiErrorPayload>(response, fallback);
  const serverMessage = result.ok ? formatApiError(result.payload) : undefined;
  return new MobileApiResponseError(
    response.status,
    blockWordingForServerMessage(serverMessage ?? (result.ok ? `${fallback}: ${response.status}` : result.message)),
    Boolean(serverMessage)
  );
}

async function errorMessage(response: Response, fallback: string) {
  const result = await readApiJson<ApiErrorPayload>(response, fallback);
  if (!result.ok) return blockWordingForServerMessage(result.message);
  const payload = result.payload;
  return blockWordingForServerMessage(formatApiError(payload) ?? `${fallback}: ${response.status}`);
}

/**
 * Server messages reach alerts as they are; an older server may still say "time entry", "entry" or
 * "timer", so the iPhone says block instead (UIA-100). Only these nouns change.
 */
export function blockWordingForServerMessage(message: string) {
  return message
    .replace(/\bTime entries\b/g, "Blocks").replace(/\btime entries\b/g, "blocks")
    .replace(/\bTime entry\b/g, "Block").replace(/\btime entry\b/g, "block")
    .replace(/\bEntries\b/g, "Blocks").replace(/\bentries\b/g, "blocks")
    .replace(/\bEntry\b/g, "Block").replace(/\bentry\b/g, "block")
    .replace(/\bTimers\b/g, "Blocks").replace(/\btimers\b/g, "blocks")
    .replace(/\bTimer\b/g, "Block").replace(/\btimer\b/g, "block");
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
  const label = blockingEntry.description?.trim() || blockingEntry.source || "an existing block";
  const status = blockingEntry.reviewStatus ? ` (${blockingEntry.reviewStatus})` : "";
  return `Blocked by ${label}${status}.`;
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
