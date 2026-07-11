import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedEvent } from "./api";

const secureStore = vi.hoisted(() => new Map<string, string>());
const asyncStore = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureStore.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: vi.fn((key: string) => {
    secureStore.delete(key);
    return Promise.resolve();
  })
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStore.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStore.set(key, value);
      return Promise.resolve();
    })
  }
}));

vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe.test"
}));

const {
  AuthRequiredError,
  buildQueueDiagnosticsSnapshot,
  clearFailedQueuedEvents,
  confirmReviewItem,
  createCategory,
  createManualTimeEntry,
  createPlace,
  deleteTimeEntry,
  deletePlace,
  dismissReviewItem,
  enqueueEvent,
  fetchBootstrap,
  getQueueDiagnostics,
  getSessionToken,
  isNetworkTimerError,
  login,
  readQueue,
  reprocessHealthReviewItems,
  retryFailedQueuedEvents,
  saveEditedReviewItem,
  startTimer,
  signup,
  syncQueue,
  updateCategory,
  updatePlace,
  updateTimeEntry,
  archiveCategory
} = await import("./api");

describe("mobile API client", () => {
  beforeEach(() => {
    vi.useRealTimers();
    secureStore.clear();
    asyncStore.clear();
    vi.restoreAllMocks();
  });

  it("stores the Dayframe app session token after login", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            token: "dayframe-token",
            user: { id: "user-1", email: "user@example.com", name: "User" },
            workspace: { id: "workspace-1", name: "Workspace" },
            expiresAt: "2026-08-01T00:00:00.000Z"
          })
        )
      )
    );

    const result = await login("user@example.com", "password");

    expect("token" in result ? result.token : null).toBe("dayframe-token");
    await expect(getSessionToken()).resolves.toBe("dayframe-token");
  });

  it("does not store a token for email-confirmation signup responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              requiresEmailConfirmation: true,
              message: "Check your email to confirm your account.",
              user: { id: "user-1", email: "user@example.com", name: "User" },
              workspace: { id: "workspace-1", name: "Workspace" }
            },
            202
          )
        )
      )
    );

    const result = await signup("user@example.com", "password", "User", "Workspace");

    expect("requiresEmailConfirmation" in result && result.requiresEmailConfirmation).toBe(true);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("clears the session token when bootstrap returns 401", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required" }, 401))));

    await expect(fetchBootstrap()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("requests bootstrap data for a selected date", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      entries: [],
      places: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          name: "Kids' school",
          latitude: 51.5,
          longitude: -0.12,
          radiusMeters: 100,
          priority: 5,
          defaultProjectId: null,
          defaultCategoryId: "20000000-0000-4000-8000-000000000001",
          defaultActivityDescription: "School drop-off/pickup"
        }
      ]
    })));
    vi.stubGlobal("fetch", fetchMock);

    const bootstrap = await fetchBootstrap({ date: "2026-07-06" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/bootstrap?date=2026-07-06",
      expect.objectContaining({
        headers: { Authorization: "Bearer session-token" }
      })
    );
    expect(bootstrap.places[0].defaultActivityDescription).toBe("School drop-off/pickup");
  });

  it("migrates old queued items without losing their event fields", async () => {
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        {
          source: "mobile_app",
          type: "timer_stop",
          occurredAt: "2026-07-06T08:15:00.000Z",
          localId: "local-1",
          queuedAt: "2026-07-06T08:16:00.000Z",
          rawPayload: { order: 1 }
        }
      ])
    );

    const queue = await readQueue();

    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual(
      expect.objectContaining({
        source: "mobile_app",
        type: "timer_stop",
        localId: "local-1",
        queuedAt: "2026-07-06T08:16:00.000Z",
        rawPayload: { order: 1 }
      })
    );
    expect(queue[0].occurredAt.toISOString()).toBe("2026-07-06T08:15:00.000Z");
    expect(queue[0].failureCount).toBeUndefined();
    expect(queue[0].lastError).toBeUndefined();
  });

  it("migrates stale queue workspace fields without losing Health payload details", async () => {
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        storedQueuedEvent({
          source: "health_sleep",
          type: "health_sleep_import",
          workspaceId: "00000000-0000-4000-8000-000000000010",
          userId: "00000000-0000-4000-8000-000000000001",
          clientEventId: "stale-client-event-id",
          rawPayload: {
            provider: "healthkit",
            externalSampleId: "sleep-sample-1",
            workspaceId: "00000000-0000-4000-8000-000000000010"
          }
        })
      ])
    );

    const queue = await readQueue();

    expect(queue).toHaveLength(1);
    expect((queue[0] as Record<string, unknown>).workspaceId).toBeUndefined();
    expect((queue[0] as Record<string, unknown>).userId).toBeUndefined();
    expect((queue[0] as Record<string, unknown>).clientEventId).toBeUndefined();
    expect(queue[0].rawPayload).toEqual({
      provider: "healthkit",
      externalSampleId: "sleep-sample-1",
      workspaceId: "00000000-0000-4000-8000-000000000010"
    });
  });

  it("syncs a queued Health event without posting stale client workspace fields", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        storedQueuedEvent({
          localId: "local-health-sleep-1",
          source: "health_sleep",
          type: "health_sleep_import",
          workspaceId: "00000000-0000-4000-8000-000000000010",
          userId: "00000000-0000-4000-8000-000000000001",
          clientEventId: "stale-client-event-id",
          rawPayload: {
            provider: "healthkit",
            externalSampleId: "sleep-sample-1",
            sleepStage: "asleep_core",
            workspaceId: "00000000-0000-4000-8000-000000000010"
          }
        })
      ])
    );
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ eventId: "event-1" }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(requestInit.body)) as Record<string, unknown>;

    expect(result.synced).toEqual(["local-health-sleep-1"]);
    expect(result.remaining).toHaveLength(0);
    expect(body.clientEventId).toBe("local-health-sleep-1");
    expect(body.workspaceId).toBeUndefined();
    expect(body.userId).toBeUndefined();
    expect(body.localId).toBeUndefined();
    expect(body.queuedAt).toBeUndefined();
    expect(body.rawPayload).toEqual({
      provider: "healthkit",
      externalSampleId: "sleep-sample-1",
      sleepStage: "asleep_core",
      workspaceId: "00000000-0000-4000-8000-000000000010"
    });
    await expect(readQueue()).resolves.toHaveLength(0);
  });

  it("preserves queue order when the first event fails to sync", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 1 } });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 2 } });
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "Server error" }, 500)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.synced).toEqual([]);
    expect(result.remaining).toHaveLength(2);
    expect(result.remaining[0].rawPayload).toEqual({ order: 1 });
    expect(result.remaining[1].rawPayload).toEqual({ order: 2 });
    expect(result.failedCount).toBe(1);
    expect(result.firstError?.message).toBe("Server error");
  });

  it("dedupes queued events that reuse a deterministic local id", async () => {
    await enqueueEvent({ localId: "location-visit-1", source: "mobile_app", type: "timer_stop" });
    await enqueueEvent({ localId: "location-visit-1", source: "mobile_app", type: "timer_stop" });

    const queue = await readQueue();

    expect(queue).toHaveLength(1);
    expect(queue[0].localId).toBe("location-visit-1");
  });

  it("queues Shortcut starts only with values supplied by the Shortcut", async () => {
    await enqueueEvent({
      source: "shortcut",
      type: "shortcut_action",
      categoryId: "20000000-0000-4000-8000-000000000004",
      description: "School pickup"
    });

    const queue = await readQueue();
    expect(queue[0]).toEqual(
      expect.objectContaining({
        source: "shortcut",
        type: "shortcut_action",
        categoryId: "20000000-0000-4000-8000-000000000004",
        description: "School pickup"
      })
    );
  });

  it("removes synced events and preserves later unsynced events", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 1 } });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 2 } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ eventId: "event-1", duplicate: true }, 200))
      .mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(result.synced).toHaveLength(1);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].rawPayload).toEqual({ order: 2 });
  });

  it("records validation failures and continues syncing later valid events", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 1 } });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { order: 2 } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: JSON.stringify([
              { path: ["type"], message: "Invalid enum value. Expected timer_stop." }
            ])
          },
          400
        )
      )
      .mockResolvedValueOnce(jsonResponse({ eventId: "event-2" }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.syncedCount).toBe(1);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0]).toEqual(
      expect.objectContaining({
        failureCount: 1,
        failureKind: "permanent",
        lastError: "type: Invalid enum value. Expected timer_stop.",
        lastStatusCode: 400,
        rawPayload: { order: 1 }
      })
    );
    expect(result.failedCount).toBe(1);
    expect(getQueueDiagnostics(result.remaining).clearableFailedCount).toBe(1);
  });

  it("keeps network failures queued for retry with failure metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:20:00.000Z"));
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: { offline: true } });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Network request failed"))));

    const result = await syncQueue();
    const persisted = await readQueue();

    expect(result.syncedCount).toBe(0);
    expect(result.remainingCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.remaining[0]).toEqual(
      expect.objectContaining({
        failureCount: 1,
        failureKind: "network",
        lastError: "Network request failed",
        lastAttemptedAt: "2026-07-06T08:20:00.000Z",
        nextRetryAt: "2026-07-06T08:20:30.000Z"
      })
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0].rawPayload).toEqual({ offline: true });
  });

  it("respects retry backoff before automatic queue sync tries a failed item again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:20:00.000Z"));
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        storedQueuedEvent({
          localId: "network-local",
          failedAt: "2026-07-06T08:20:00.000Z",
          failureKind: "network",
          failureCount: 1,
          lastError: "Network request failed",
          lastAttemptedAt: "2026-07-06T08:20:00.000Z",
          nextRetryAt: "2026-07-06T08:20:30.000Z"
        })
      ])
    );
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ eventId: "event-1" }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.syncedCount).toBe(0);
    expect(result.remainingCount).toBe(1);
    expect(result.stopped).toBe(true);
    expect(result.firstError).toEqual(
      expect.objectContaining({
        localId: "network-local",
        failureKind: "network",
        message: "Next retry 2026-07-06T08:20:30.000Z."
      })
    );
  });

  it("manual failed retry bypasses retry backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:20:10.000Z"));
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        storedQueuedEvent({
          localId: "network-local",
          failedAt: "2026-07-06T08:20:00.000Z",
          failureKind: "network",
          failureCount: 1,
          lastError: "Network request failed",
          lastAttemptedAt: "2026-07-06T08:20:00.000Z",
          nextRetryAt: "2026-07-06T08:20:30.000Z"
        })
      ])
    );
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ eventId: "event-1" }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await retryFailedQueuedEvents();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.synced).toEqual(["network-local"]);
    expect(result.remaining).toHaveLength(0);
  });

  it("clears the session token when queued event sync returns 401", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "expired-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop" });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required" }, 401))));

    await expect(syncQueue()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
    await expect(readQueue()).resolves.toHaveLength(1);
  });

  it("retries failed queued events without retrying healthy queued events", async () => {
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        storedQueuedEvent({
          localId: "failed-local",
          rawPayload: { failed: true },
          failedAt: "2026-07-06T08:20:00.000Z",
          failureKind: "permanent",
          failureCount: 1,
          lastError: "type: Invalid event type",
          lastStatusCode: 400,
          lastAttemptedAt: "2026-07-06T08:20:00.000Z"
        }),
        storedQueuedEvent({
          localId: "healthy-local",
          rawPayload: { healthy: true }
        })
      ])
    );
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ eventId: "event-1" }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await retryFailedQueuedEvents();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.synced).toEqual(["failed-local"]);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].localId).toBe("healthy-local");
  });

  it("clears failed invalid queued events without removing valid queued items", async () => {
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        storedQueuedEvent({
          localId: "invalid-local",
          rawPayload: { invalid: true },
          failedAt: "2026-07-06T08:20:00.000Z",
          failureKind: "permanent",
          failureCount: 1,
          lastError: "type: Invalid event type",
          lastStatusCode: 400,
          lastAttemptedAt: "2026-07-06T08:20:00.000Z"
        }),
        storedQueuedEvent({
          localId: "network-local",
          rawPayload: { offline: true },
          failedAt: "2026-07-06T08:21:00.000Z",
          failureKind: "network",
          failureCount: 1,
          lastError: "Network request failed",
          lastAttemptedAt: "2026-07-06T08:21:00.000Z"
        }),
        storedQueuedEvent({
          localId: "healthy-local",
          rawPayload: { healthy: true }
        })
      ])
    );

    const result = await clearFailedQueuedEvents();
    const remainingIds = result.remaining.map((item) => item.localId);

    expect(result.removed.map((item) => item.localId)).toEqual(["invalid-local"]);
    expect(remainingIds).toEqual(["network-local", "healthy-local"]);
    await expect(readQueue()).resolves.toHaveLength(2);
  });

  it("builds an exportable queue diagnostics snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:22:00.000Z"));
    const queue = [
      storedQueuedEvent({
        localId: "network-local",
        failedAt: "2026-07-06T08:20:00.000Z",
        failureKind: "network",
        failureCount: 1,
        lastError: "Network request failed",
        lastAttemptedAt: "2026-07-06T08:20:00.000Z",
        nextRetryAt: "2026-07-06T08:20:30.000Z",
        rawPayload: { origin: "shortcut" }
      }),
      storedQueuedEvent({
        localId: "invalid-local",
        failedAt: "2026-07-06T08:21:00.000Z",
        failureKind: "permanent",
        failureCount: 1,
        lastError: "type: Invalid event type",
        lastStatusCode: 400,
        lastAttemptedAt: "2026-07-06T08:21:00.000Z"
      })
    ].map((item, index) => readMigratedQueuedEventForTest(item, index));

    const snapshot = buildQueueDiagnosticsSnapshot(queue, {
      synced: [],
      remaining: queue,
      failed: queue,
      syncedCount: 0,
      remainingCount: 2,
      failedCount: 2,
      stopped: true
    });

    expect(snapshot.exportedAt).toBe("2026-07-06T08:22:00.000Z");
    expect(snapshot.diagnostics).toEqual(
      expect.objectContaining({
        queuedCount: 2,
        failedCount: 2,
        retryableFailedCount: 1,
        permanentFailedCount: 1,
        clearableFailedCount: 1,
        nextRetryAt: "2026-07-06T08:20:30.000Z",
        lastAttemptedAt: "2026-07-06T08:21:00.000Z"
      })
    );
    expect(snapshot.queue[0]).toEqual(
      expect.objectContaining({
        occurredAt: "2026-07-06T08:15:00.000Z",
        rawPayload: { origin: "shortcut" }
      })
    );
    expect(snapshot.lastSyncResult).toEqual(
      expect.objectContaining({
        remainingCount: 2,
        failedCount: 2,
        stopped: true
      })
    );
  });

  it("starts timers with an optional category and no project", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await startTimer("20000000-0000-4000-8000-000000000001", "Write notes");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "start",
          source: "mobile_app",
          categoryId: "20000000-0000-4000-8000-000000000001",
          description: "Write notes"
        })
      })
    );
  });

  it("starts uncategorized timers when no category is selected", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await startTimer(null, "Capture loose task");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "start",
          source: "mobile_app",
          description: "Capture loose task"
        })
      })
    );
  });

  it("omits blank timer descriptions from mobile starts", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await startTimer("20000000-0000-4000-8000-000000000001", "   ");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "start",
          source: "mobile_app",
          categoryId: "20000000-0000-4000-8000-000000000001"
        })
      })
    );
  });

  it("creates pinned categories through the hosted API", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await createCategory("DIY", { isPinned: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/categories",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "DIY",
          color: "lime",
          isPinned: true
        })
      })
    );
  });

  it("updates category name, color and pin state through the hosted API", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, category: { id: "20000000-0000-4000-8000-000000000001", name: "Deep work", color: "sky", isPinned: true } }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await updateCategory("20000000-0000-4000-8000-000000000001", {
      name: "Deep work",
      color: "sky",
      isPinned: true
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/categories",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          id: "20000000-0000-4000-8000-000000000001",
          name: "Deep work",
          color: "sky",
          isPinned: true
        })
      })
    );
  });

  it("unpins categories through the hosted API", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, category: { id: "20000000-0000-4000-8000-000000000001", name: "Deep work", color: "sky", isPinned: false } }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await updateCategory("20000000-0000-4000-8000-000000000001", { isPinned: false });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/categories",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          id: "20000000-0000-4000-8000-000000000001",
          isPinned: false
        })
      })
    );
  });

  it("deletes categories through the hosted API", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await archiveCategory("20000000-0000-4000-8000-000000000001");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/categories?id=20000000-0000-4000-8000-000000000001",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("creates places through the hosted API without auto-start", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const savedPlace = {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Gym",
      latitude: 51.5,
      longitude: -0.12,
      radiusMeters: 100,
      priority: 5,
      defaultProjectId: null,
      defaultCategoryId: "20000000-0000-4000-8000-000000000001",
      defaultCategoryName: "Fitness",
      defaultActivityDescription: "School drop-off/pickup"
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 201))
      .mockResolvedValueOnce(jsonResponse({ places: [savedPlace] }, 200));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPlace({
      name: "Gym",
      latitude: 51.5,
      longitude: -0.12,
      radiusMeters: 100,
      priority: 5,
      defaultCategoryId: "20000000-0000-4000-8000-000000000001",
      defaultActivityDescription: " School drop-off/pickup "
    });

    expect(result.place).toEqual(savedPlace);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://dayframe.test/api/entities",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer session-token"
        },
        body: JSON.stringify({
          entity: "place",
          values: {
            name: "Gym",
            latitude: 51.5,
            longitude: -0.12,
            radiusMeters: 100,
            priority: 5,
            categoryId: "20000000-0000-4000-8000-000000000001",
            defaultActivityDescription: "School drop-off/pickup",
            autoStart: false
          }
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://dayframe.test/api/bootstrap",
      expect.objectContaining({
        headers: { Authorization: "Bearer session-token" }
      })
    );
  });

  it("updates places through the hosted API without project fields", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, place: { id: "place-1" } }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await updatePlace("30000000-0000-4000-8000-000000000001", {
      name: "Office",
      radiusMeters: 150,
      defaultCategoryId: null,
      defaultActivityDescription: "Office work"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/places",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          id: "30000000-0000-4000-8000-000000000001",
          name: "Office",
          radiusMeters: 150,
          defaultCategoryId: null,
          defaultActivityDescription: "Office work",
          autoStart: false
        })
      })
    );
  });

  it("rejects place saves when the API does not return the saved place", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(jsonResponse({ ok: true }, 201))
        .mockResolvedValueOnce(jsonResponse({ places: [] }, 200))
    );

    await expect(createPlace({ name: "Gym", latitude: 51.5, longitude: -0.12, radiusMeters: 100 })).rejects.toThrow(
      /refreshed place list/
    );
  });

  it("does not surface raw HTML when a place route returns a hosted 404 page", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(htmlResponse("<!DOCTYPE html><title>404: This page could not be found</title>"))
      )
    );

    await expect(createPlace({ name: "Gym", latitude: 51.5, longitude: -0.12, radiusMeters: 100 })).rejects.toThrow(
      "Unable to save place. The server route was not found."
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "Dayframe API returned a non-JSON response.",
      expect.objectContaining({
        status: 200,
        contentType: "text/html; charset=utf-8",
        bodyPreview: expect.stringContaining("404: This page could not be found")
      })
    );
  });

  it("deletes places through the hosted API", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await deletePlace("30000000-0000-4000-8000-000000000001");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/places?id=30000000-0000-4000-8000-000000000001",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("deletes running time entries through the hosted API without queueing", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, id: "entry-1", deleted: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await deleteTimeEntry("entry-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries/entry-1",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer session-token" }
      })
    );
    expect(asyncStore.get("dayframe.offlineQueue.v1")).toBeUndefined();
  });

  it("updates running time entries through the hosted API without queueing", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await updateTimeEntry("entry-1", {
      categoryId: "20000000-0000-4000-8000-000000000001",
      description: "Write review notes",
      startedAt: "2026-07-06T08:15:00.000Z"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries/entry-1",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer session-token"
        },
        body: JSON.stringify({
          categoryId: "20000000-0000-4000-8000-000000000001",
          description: "Write review notes",
          startedAt: "2026-07-06T08:15:00.000Z"
        })
      })
    );
    expect(asyncStore.get("dayframe.offlineQueue.v1")).toBeUndefined();
  });

  it("creates manual time entries for edited suggestions", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await createManualTimeEntry({
      categoryId: "20000000-0000-4000-8000-000000000001",
      description: "Edited workout",
      startedAt: "2026-07-07T09:00:00.000Z",
      stoppedAt: "2026-07-07T10:00:00.000Z"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer session-token"
        },
        body: JSON.stringify({
          mode: "manual",
          categoryId: "20000000-0000-4000-8000-000000000001",
          description: "Edited workout",
          startedAt: "2026-07-07T09:00:00.000Z",
          stoppedAt: "2026-07-07T10:00:00.000Z"
        })
      })
    );
  });

  it("confirms and dismisses review items through the hosted API", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await confirmReviewItem("review-1");
    await dismissReviewItem("review-2");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://dayframe.test/api/review/review-1",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer session-token"
        },
        body: JSON.stringify({ action: "accept" })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://dayframe.test/api/review/review-2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "ignore_once" })
      })
    );
  });

  it("surfaces structured review confirm errors from the hosted API", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({
          ok: false,
          code: "overlap",
          message: "This activity overlaps an existing entry.",
          blockingEntry: {
            description: "BAU",
            source: "manual_app",
            reviewStatus: "confirmed",
            startedAt: "2026-07-04T08:00:00.000Z",
            stoppedAt: null
          }
        }, 409))
      )
    );

    await expect(confirmReviewItem("review-overlap")).rejects.toThrow(
      "This activity overlaps an existing entry. Blocked by BAU (confirmed)."
    );
  });

  it("treats already-resolved review items as idempotent success", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({
          ok: false,
          code: "already_resolved",
          message: "This review item has already been resolved."
        }, 409))
      )
    );

    await expect(confirmReviewItem("review-accepted")).resolves.toMatchObject({
      ok: true,
      alreadyResolved: true
    });
  });

  it("reprocesses existing Health review items with current preferences", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({
        ok: true,
        checkedCount: 3,
        confirmedCount: 2,
        ignoredCount: 0,
        leftInReviewCount: 1,
        skippedCount: 0,
        failedCount: 0,
        updatedCategoryCount: 3,
        remainingReviewCount: 1,
        errorSummary: [],
        reasons: [
          {
            reviewItemId: "review-overlap",
            code: "overlap",
            message: "Left in Review: overlaps stale open timer \"BAU\" with no stop time."
          }
        ]
      }, 200))
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await reprocessHealthReviewItems({
      sleep: true,
      walking: true,
      running: true,
      cycling: true,
      strength_training: false,
      swimming: false,
      other: false
    });

    expect(result.confirmedCount).toBe(2);
    expect(result.reasons?.[0]?.code).toBe("overlap");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/review/reprocess-health",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer session-token"
        },
        body: JSON.stringify({
          preferences: {
            sleep: true,
            walking: true,
            running: true,
            cycling: true,
            strength_training: false,
            swimming: false,
            other: false
          }
        })
      })
    );
  });

  it("can force a Health review reprocess batch from mobile", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({
        ok: true,
        checkedCount: 0,
        confirmedCount: 0,
        ignoredCount: 0,
        leftInReviewCount: 0,
        skippedCount: 0,
        failedCount: 0,
        updatedCategoryCount: 0,
        remainingReviewCount: 0,
        errorSummary: []
      }, 200))
    );
    vi.stubGlobal("fetch", fetchMock);

    await reprocessHealthReviewItems({
      sleep: true,
      walking: true,
      running: true,
      cycling: true,
      strength_training: false,
      swimming: false,
      other: false
    }, { limit: 12, force: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/review/reprocess-health",
      expect.objectContaining({
        body: expect.stringContaining('"force":true')
      })
    );
  });

  it("passes Health auto-log mappings when reprocessing review items", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({
        ok: true,
        checkedCount: 0,
        confirmedCount: 0,
        ignoredCount: 0,
        leftInReviewCount: 0,
        skippedCount: 0,
        failedCount: 0,
        updatedCategoryCount: 0,
        remainingReviewCount: 0,
        errorSummary: []
      }, 200))
    );
    vi.stubGlobal("fetch", fetchMock);

    await reprocessHealthReviewItems({
      sleep: true,
      walking: true,
      running: true,
      cycling: true,
      strength_training: false,
      swimming: false,
      other: false
    }, {
      mappings: {
        walking: {
          categoryId: "category-fitness",
          description: "Morning walk"
        }
      }
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/review/reprocess-health",
      expect.objectContaining({
        body: expect.stringContaining('"mappings":{"walking":{"categoryId":"category-fitness","description":"Morning walk"}}')
      })
    );
  });

  it("saves edited review items by creating confirmed time then dismissing the suggestion", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await saveEditedReviewItem("review-1", {
      categoryId: null,
      description: "Adjusted suggestion",
      startedAt: "2026-07-07T09:15:00.000Z",
      stoppedAt: "2026-07-07T10:10:00.000Z"
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "manual",
          categoryId: undefined,
          description: "Adjusted suggestion",
          startedAt: "2026-07-07T09:15:00.000Z",
          stoppedAt: "2026-07-07T10:10:00.000Z"
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://dayframe.test/api/review/review-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "ignore_once" })
      })
    );
  });

  it("clears the session token when deleting a time entry returns 401", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required." }, 401))));

    await expect(deleteTimeEntry("entry-1")).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("clears the session token when updating a time entry returns 401", async () => {
    secureStore.set("dayframe.localSessionToken.v1", "expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required." }, 401))));

    await expect(updateTimeEntry("entry-1", { startedAt: "2026-07-06T08:15:00.000Z" })).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("recognizes network failures as timer-queue fallback candidates", () => {
    expect(isNetworkTimerError(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkTimerError(new Error("Timer action failed: 500"))).toBe(false);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function storedQueuedEvent(overrides: Record<string, unknown> = {}) {
  return {
    source: "mobile_app",
    type: "timer_stop",
    occurredAt: "2026-07-06T08:15:00.000Z",
    localId: "local-1",
    queuedAt: "2026-07-06T08:16:00.000Z",
    rawPayload: {},
    ...overrides
  };
}

function readMigratedQueuedEventForTest(item: ReturnType<typeof storedQueuedEvent>, _index: number): QueuedEvent {
  return {
    ...item,
    source: item.source as QueuedEvent["source"],
    type: item.type as QueuedEvent["type"],
    occurredAt: new Date(item.occurredAt)
  };
}
