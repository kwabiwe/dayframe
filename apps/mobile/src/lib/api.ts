import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  ActivityEventInputSchema,
  type ActivityEventInput,
  type ActivityEventType,
  type EventSource
} from "@dayframe/shared";
import { DAYFRAME_API_BASE } from "./config";

const QUEUE_KEY = "dayframe.offlineQueue.v1";
const SESSION_TOKEN_KEY = "dayframe.localSessionToken.v1";

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
  reviewCount: number;
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
  source: string;
  confidence: string;
  reviewStatus: string;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number;
};

export type MobileBootstrap = {
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
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
  entries: MobileTimeEntry[];
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
    defaultCategoryId: string | null;
  }>;
  reviewItems: Array<{ id: string; title: string; confidence: string; status: string }>;
};

export type MobileCategoryResponse = {
  ok: true;
  category: MobileBootstrap["categories"][number];
};

export type MobilePlace = MobileBootstrap["places"][number];

export type MobilePlaceResponse = {
  ok: true;
  place: MobilePlace;
};

export type PlaceMutationInput = {
  name?: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number;
  priority?: number;
  defaultCategoryId?: string | null;
};

export type TimeEntryUpdatePatch = {
  categoryId?: string | null;
  description?: string | null;
  startedAt?: string;
  stoppedAt?: string | null;
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
  failedAt?: string;
  failureCount?: number;
  lastError?: string;
  lastStatusCode?: number;
  lastAttemptedAt?: string;
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
  remaining: QueuedEvent[];
  failed: QueuedEvent[];
  syncedCount: number;
  remainingCount: number;
  failedCount: number;
  firstError?: QueueFailureReport;
  stopped: boolean;
};

export type QueueDiagnostics = {
  queuedCount: number;
  failedCount: number;
  clearableFailedCount: number;
  firstFailed?: QueuedEvent;
};

type SyncQueueOptions = {
  retryFailed?: boolean;
  onlyFailed?: boolean;
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
  | "failureKind"
>;

type ActivityEventDraft = {
  source: EventSource;
  type: ActivityEventType;
  occurredAt?: Date;
  deviceId?: string;
  projectId?: string;
  categoryId?: string;
  placeId?: string;
  description?: string;
  rawPayload?: Record<string, unknown>;
};

export async function fetchBootstrap(options: { date?: string } = {}): Promise<MobileBootstrap> {
  const params = options.date ? `?date=${encodeURIComponent(options.date)}` : "";
  const response = await fetch(`${DAYFRAME_API_BASE}/api/bootstrap${params}`, {
    headers: await authHeaders()
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, "Unable to load Dayframe API"));
  }
  return readJsonResponse<MobileBootstrap>(response);
}

export async function login(email: string, password: string) {
  return authenticate("/api/auth/login", { email, password });
}

export async function signup(email: string, password: string, name?: string, workspaceName?: string) {
  return authenticate("/api/auth/signup", { email, password, name, workspaceName });
}

export async function logout() {
  const token = await getSessionToken();
  await fetch(`${DAYFRAME_API_BASE}/api/auth/logout`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  }).catch(() => undefined);
  await clearSessionToken();
}

export async function getSessionToken() {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function clearSessionToken() {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}

export async function enqueueEvent(input: ActivityEventDraft) {
  const parsed = ActivityEventInputSchema.parse({
    ...input,
    occurredAt: input.occurredAt ?? new Date(),
    rawPayload: input.rawPayload ?? {}
  });
  const queue = await readQueue();
  queue.push({
    ...queuedEventFromParsedEvent(parsed),
    localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString()
  });
  await writeQueue(queue);
  return queue;
}

export async function readQueue(): Promise<QueuedEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as StoredQueuedEvent[];
  return parsed.map(migrateQueuedEvent);
}

export function getQueueDiagnostics(queue: QueuedEvent[]): QueueDiagnostics {
  const failed = queue.filter(hasQueueFailure);
  return {
    queuedCount: queue.length,
    failedCount: failed.length,
    clearableFailedCount: queue.filter(isClearableFailedEvent).length,
    firstFailed: failed[0]
  };
}

export async function retryFailedQueuedEvents() {
  return syncQueue({ retryFailed: true, onlyFailed: true });
}

export async function clearFailedQueuedEvents() {
  const queue = await readQueue();
  const remaining = queue.filter((item) => !isClearableFailedEvent(item));
  const removed = queue.filter(isClearableFailedEvent);
  await writeQueue(remaining);
  return {
    removed,
    remaining,
    removedCount: removed.length,
    remainingCount: remaining.length
  };
}

export async function syncQueue(options: SyncQueueOptions = {}): Promise<SyncQueueResult> {
  const queue = await readQueue();
  const remaining: QueuedEvent[] = [];
  const synced: string[] = [];
  let firstError: QueueFailureReport | undefined;
  let stopped = false;

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
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

    const attemptedAt = new Date().toISOString();
    try {
      const response = await fetch(`${DAYFRAME_API_BASE}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders())
        },
        body: JSON.stringify(queuedEventRequestBody(item))
      });
      if (response.status === 401 || response.status === 403) {
        await clearSessionToken();
        throw new AuthRequiredError();
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

  await writeQueue(remaining);
  return queueSyncResult(synced, remaining, firstError, stopped);
}

export async function startTimer(categoryId?: string | null, description?: string) {
  return postTimerAction({
    mode: "start",
    source: "mobile_app",
    categoryId: categoryId ?? undefined,
    description: description?.trim() || undefined
  });
}

export async function stopTimer() {
  return postTimerAction({
    mode: "stop",
    source: "mobile_app"
  });
}

export async function deleteTimeEntry(id: string) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/time-entries/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders()
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to delete timer"));
  return readJsonResponse(response);
}

export async function updateTimeEntry(id: string, patch: TimeEntryUpdatePatch) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/time-entries/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify(patch)
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update timer"));
  return readJsonResponse(response);
}

export async function createCategory(
  name: string,
  options: { color?: string; isPinned?: boolean } = {}
): Promise<MobileCategoryResponse> {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/categories`, {
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
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to create category"));
  return readJsonResponse(response);
}

export async function updateCategory(
  id: string,
  options: { name?: string; color?: string; isPinned?: boolean }
): Promise<MobileCategoryResponse> {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/categories`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ id, ...options })
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update category"));
  return readJsonResponse(response);
}

export async function archiveCategory(id: string) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/categories?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders()
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to delete category"));
  return readJsonResponse(response);
}

export async function createPlace(input: { name: string } & PlaceMutationInput) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/places`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({
      ...input,
      autoStart: false
    })
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to create place"));
  return readJsonResponse<MobilePlaceResponse>(response);
}

export async function updatePlace(id: string, input: PlaceMutationInput) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/places`, {
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
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update place"));
  return readJsonResponse<MobilePlaceResponse>(response);
}

export async function deletePlace(id: string) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/places?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders()
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to delete place"));
  return readJsonResponse(response);
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
  const message = error.message.toLowerCase();
  return (
    error.name === "TypeError" ||
    message.includes("network request failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("internet connection")
  );
}

const permanentStatusCodes = new Set([400, 413, 422]);

function migrateQueuedEvent(item: StoredQueuedEvent, index: number): QueuedEvent {
  const queueItem = { ...item };
  delete queueItem.workspaceId;
  delete queueItem.userId;
  delete queueItem.clientEventId;

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
  const failureKind = isQueueFailureKind(item.failureKind)
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
    failedAt: validIsoString(item.failedAt),
    failureCount,
    lastError: typeof item.lastError === "string" && item.lastError.trim() ? item.lastError : undefined,
    lastStatusCode,
    lastAttemptedAt: validIsoString(item.lastAttemptedAt),
    failureKind
  };
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
  return {
    ...item,
    failedAt: new Date().toISOString(),
    failureCount: (item.failureCount ?? 0) + 1,
    lastError: message,
    lastStatusCode: statusCode,
    lastAttemptedAt: attemptedAt,
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

function queueSyncResult(
  synced: string[],
  remaining: QueuedEvent[],
  firstError: QueueFailureReport | undefined,
  stopped: boolean
): SyncQueueResult {
  const failed = remaining.filter(hasQueueFailure);
  return {
    synced,
    remaining,
    failed,
    syncedCount: synced.length,
    remainingCount: remaining.length,
    failedCount: failed.length,
    firstError,
    stopped
  };
}

async function writeQueue(queue: QueuedEvent[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
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

export class AuthRequiredError extends Error {
  constructor() {
    super("Login required");
    this.name = "AuthRequiredError";
  }
}

async function authenticate(path: string, body: Record<string, unknown>): Promise<MobileAuthResult> {
  const response = await fetch(`${DAYFRAME_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await readJsonResponse<MobileAuthResult & { error?: string }>(response);
  if (!response.ok) throw new Error(payload.error ?? `Authentication failed: ${response.status}`);
  if ("requiresEmailConfirmation" in payload) return payload;
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, payload.token);
  return payload;
}

async function postTimerAction(body: Record<string, unknown>) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/time-entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify(body)
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Timer action failed"));
  return readJsonResponse(response);
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { error: text } as T;
  }
}

async function errorMessage(response: Response, fallback: string) {
  const payload = await readJsonResponse<{
    error?: string;
    message?: string;
    issues?: Array<{ path?: Array<string | number>; message?: string }>;
  }>(response);
  return formatApiError(payload) ?? `${fallback}: ${response.status}`;
}

function formatApiError(payload: {
  error?: string;
  message?: string;
  issues?: Array<{ path?: Array<string | number>; message?: string }>;
}) {
  if (payload.issues?.length) {
    return formatIssue(payload.issues[0]);
  }

  const message = payload.error ?? payload.message;
  if (!message) return undefined;

  try {
    const parsed = JSON.parse(message) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const issue = parsed[0] as { path?: Array<string | number>; message?: string };
      return formatIssue(issue);
    }
  } catch {
    return message;
  }

  return message;
}

function formatIssue(issue: { path?: Array<string | number>; message?: string }) {
  const path = issue.path?.length ? issue.path.join(".") : "event";
  return issue.message ? `${path}: ${issue.message}` : "Invalid event payload";
}
