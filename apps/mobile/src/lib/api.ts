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

export type MobileBootstrap = {
  user?: { id: string; email: string; name: string };
  workspace?: { id: string; name: string };
  activeEntry: {
    id: string;
    projectId: string | null;
    projectName: string | null;
    projectColor: string | null;
    categoryId: string | null;
    categoryName: string | null;
    description: string | null;
    durationSeconds: number;
    startedAt: string;
  } | null;
  projects: Array<{
    id: string;
    name: string;
    color: string;
    categoryId: string | null;
    categoryName: string | null;
    clientName: string | null;
  }>;
  categories: Array<{ id: string; name: string; color: string; isPinned: boolean; sortOrder?: number }>;
  entries: Array<{
    id: string;
    projectId: string | null;
    projectName: string | null;
    projectColor: string | null;
    clientName: string | null;
    categoryId: string | null;
    categoryName: string | null;
    placeName: string | null;
    source: string;
    confidence: string;
    reviewStatus: string;
    description: string | null;
    startedAt: string;
    stoppedAt: string | null;
    durationSeconds: number;
  }>;
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
  reviewItems: Array<{
    id: string;
    title: string;
    confidence: string;
    status: string;
    type?: string;
    categoryName?: string | null;
    placeName?: string | null;
    projectName?: string | null;
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

export type QueuedEvent = Omit<ActivityEventInput, "occurredAt"> & {
  occurredAt: Date;
  localId: string;
  queuedAt: string;
};

export type TimerActionResult = {
  eventId?: string;
  duplicate?: boolean;
  activeEntry?: MobileBootstrap["activeEntry"];
  candidate?: {
    action?: string;
    confidence?: string;
    reviewStatus?: string;
    title?: string;
  };
};

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

export async function fetchBootstrap(): Promise<MobileBootstrap> {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/bootstrap`, {
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
    ...parsed,
    localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString()
  });
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return queue;
}

export async function readQueue(): Promise<QueuedEvent[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Array<QueuedEvent & { occurredAt: string }>;
  return parsed.map((item) => ({
    ...item,
    occurredAt: new Date(item.occurredAt)
  }));
}

export async function syncQueue() {
  const queue = await readQueue();
  const synced: string[] = [];

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    try {
      const response = await fetch(`${DAYFRAME_API_BASE}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders())
        },
        body: JSON.stringify({
          ...item,
          clientEventId: item.localId,
          occurredAt: item.occurredAt.toISOString()
        })
      });
      if (response.status === 401) {
        await clearSessionToken();
        throw new AuthRequiredError();
      }
      if (!response.ok) throw new Error(`Sync failed: ${response.status}`);
      synced.push(item.localId);
    } catch (error) {
      if (error instanceof AuthRequiredError) throw error;
      const remaining = queue.slice(index);
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
      return { synced, remaining };
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([]));
  return { synced, remaining: [] };
}

export async function startTimer(
  projectId?: string | null,
  categoryId?: string | null,
  description?: string
): Promise<TimerActionResult> {
  return postTimerAction({
    mode: "start",
    source: "mobile_app",
    projectId: projectId ?? undefined,
    categoryId: categoryId ?? undefined,
    description: description?.trim() || undefined
  });
}

export async function stopTimer(): Promise<TimerActionResult> {
  return postTimerAction({
    mode: "stop",
    source: "mobile_app"
  });
}

export async function createCategory(name: string, options: { color?: string; isPinned?: boolean } = {}) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/entities`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({
      entity: "category",
      values: {
        name,
        color: options.color ?? "lime",
        isPinned: options.isPinned ? "true" : ""
      }
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
  input: { name?: string; color?: string; isPinned?: boolean }
) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/categories/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify(input)
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update category"));
  return readJsonResponse(response);
}

export async function archiveCategory(id: string) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/categories/${id}`, {
    method: "DELETE",
    headers: await authHeaders()
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to archive category"));
  return readJsonResponse(response);
}

export async function reorderCategories(categoryIds: string[]) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/categories`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ categoryIds })
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to reorder categories"));
  return readJsonResponse(response);
}

export async function updateTimeEntry(
  id: string,
  input: { categoryId?: string | null; description?: string | null }
) {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/time-entries/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify(input)
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update timer"));
  return readJsonResponse(response);
}

export async function resolveReviewItem(id: string, action: "accept" | "ignore_once") {
  const response = await fetch(`${DAYFRAME_API_BASE}/api/review/${id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders())
    },
    body: JSON.stringify({ action })
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) throw new Error(await errorMessage(response, "Unable to update review item"));
  return readJsonResponse(response);
}

export async function queueStopTimer() {
  return enqueueEvent({
    source: "mobile_app",
    type: "timer_stop",
    rawPayload: { origin: "mobile_home" }
  });
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

async function postTimerAction(body: Record<string, unknown>): Promise<TimerActionResult> {
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
  return readJsonResponse<TimerActionResult>(response);
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
  const payload = await readJsonResponse<{ error?: string }>(response);
  return payload.error ?? `${fallback}: ${response.status}`;
}
