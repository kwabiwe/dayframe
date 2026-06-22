import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import {
  ActivityEventInputSchema,
  type ActivityEventInput,
  type ActivityEventType,
  type EventSource
} from "@dayframe/shared";

const API_BASE = process.env.EXPO_PUBLIC_DAYFRAME_API_BASE ?? "http://localhost:3000";
const QUEUE_KEY = "dayframe.offlineQueue.v1";
const SESSION_TOKEN_KEY = "dayframe.localSessionToken.v1";

export type MobileBootstrap = {
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
  categories: Array<{ id: string; name: string; color: string }>;
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
  reviewItems: Array<{ id: string; title: string; confidence: string; status: string }>;
};

export type MobileAuthSession = {
  token: string;
  user: { id: string; email: string; name: string };
  workspace: { id: string; name: string };
  expiresAt: string;
};

export type QueuedEvent = Omit<ActivityEventInput, "occurredAt"> & {
  occurredAt: Date;
  localId: string;
  queuedAt: string;
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
  const response = await fetch(`${API_BASE}/api/bootstrap`, {
    headers: await authHeaders()
  });
  if (response.status === 401) {
    await clearSessionToken();
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error(`Unable to load Dayframe API: ${response.status}`);
  }
  return response.json();
}

export async function login(email: string, password: string) {
  return authenticate("/api/auth/login", { email, password });
}

export async function signup(email: string, password: string, name?: string, workspaceName?: string) {
  return authenticate("/api/auth/signup", { email, password, name, workspaceName });
}

export async function logout() {
  const token = await getSessionToken();
  await fetch(`${API_BASE}/api/auth/logout`, {
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
  const remaining: QueuedEvent[] = [];
  const synced: string[] = [];

  for (const item of queue) {
    try {
      const response = await fetch(`${API_BASE}/api/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(await authHeaders())
        },
        body: JSON.stringify({
          ...item,
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
      remaining.push(item);
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { synced, remaining };
}

export async function startTimer(projectId: string, categoryId?: string | null, description?: string) {
  return postTimerAction({
    mode: "start",
    source: "mobile_app",
    projectId,
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

async function authenticate(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as MobileAuthSession & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Authentication failed: ${response.status}`);
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, payload.token);
  return payload;
}

async function postTimerAction(body: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}/api/time-entries`, {
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
  if (!response.ok) throw new Error(`Timer action failed: ${response.status}`);
  return response.json();
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
