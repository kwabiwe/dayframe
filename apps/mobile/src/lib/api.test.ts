import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap, QueuedEvent } from "./api";
import {
  createOptimisticTimerStartReconciler,
  requireQueuedTimerStartRemoval,
  requireQueuedTimerStartUpdate
} from "./timerPresentation";
import { createDeletionCoordinator } from "./historyDeletion";

const TIMER_STOP_OWNER = { userId: "user-a", workspaceId: "workspace-a" };
const ACCOUNT_B_OWNER = { userId: "user-b", workspaceId: "workspace-b" };
const TIMER_TARGET_A = "80000000-0000-4000-8000-000000000001";

function storeBoundSession(token: string, owner = TIMER_STOP_OWNER) {
  secureStore.set("dayframe.localSessionToken.v2", JSON.stringify({
    version: 1,
    token,
    userId: owner.userId,
    workspaceId: owner.workspaceId
  }));
}

const secureStore = vi.hoisted(() => new Map<string, string>());
const asyncStore = vi.hoisted(() => new Map<string, string>());

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
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

vi.mock("react-native", () => ({
  NativeModules: {
    DayframeLiveActivityModule: {
      clearRuntimeContext: vi.fn(() => Promise.resolve(true)),
      clearRuntimeContextIfToken: vi.fn(() => Promise.resolve(true)),
      setRuntimeContext: vi.fn(() => Promise.resolve(true))
    }
  },
  Platform: { OS: "ios" }
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(asyncStore.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      asyncStore.set(key, value);
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      asyncStore.delete(key);
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
  createTag,
  deleteTimeEntry,
  deletePlace,
  deliverPendingTimerStop,
  dismissReviewItem,
  enqueueEvent,
  fetchBootstrap,
  fetchLocationReviewEvidence,
  fetchTimerState,
  getQueueDiagnostics,
  getSessionToken,
  ignoreLearnedPlace,
  isNetworkTimerError,
  login,
  normaliseLocationReviewRequestError,
  readQueue,
  readTimerEntryIdCorrelations,
  reprocessHealthReviewItems,
  retryFailedQueuedEvents,
  removeQueuedEvent,
  removeTimerEntryIdCorrelation,
  resolveTimerEntryIdAfterQueueBarrier,
  resolveLocationReviewItem,
  saveEditedReviewItem,
  startTimer,
  stopTimer,
  signup,
  syncQueue,
  updateCategory,
  updatePlace,
  updateQueuedTimerStart,
  updateTimeEntry,
  archiveCategory
} = await import("./api");
const {
  getOrCreatePendingStop,
  readPendingTimerStops
} = await import("./timerStopOutbox");
const {
  readAuthenticatedSessionSnapshot,
  readOwnedAuthenticatedSessionSnapshot,
  resetSessionTokenCacheForTesting,
  setSessionToken
} = await import("./secure-session");
const {
  __resetMobileAccountForTests,
  activateMobileAccount
} = await import("./mobileAccount");
const SecureStore = await import("expo-secure-store");
const {
  MobileRequestTimeoutError,
  StaleMobileSessionResponseError
} = await import("./mobile-network");
const { projectDurableLocalWork } = await import("./durableLocalProjection");
const { synchronisePendingTimerStops } = await import("./timerStopSync");

describe("mobile API client", () => {
  beforeEach(async () => {
    vi.useRealTimers();
    resetSessionTokenCacheForTesting();
    secureStore.clear();
    asyncStore.clear();
    vi.restoreAllMocks();
    __resetMobileAccountForTests();
    await activateMobileAccount(TIMER_STOP_OWNER);
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

  it("bounds a stalled login request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    const request = login("user@example.com", "password");
    const rejection = expect(request).rejects.toBeInstanceOf(MobileRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    await expect(getSessionToken()).resolves.toBeNull();
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
    storeBoundSession("expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required" }, 401))));

    await expect(fetchBootstrap()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("bounds and cancels location evidence requests without leaking cookie credentials", async () => {
    vi.useFakeTimers();
    storeBoundSession("session-token");
    const stalledFetch = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", stalledFetch);

    const timedOut = fetchLocationReviewEvidence("review-1");
    const timeoutRejection = expect(timedOut).rejects.toMatchObject({
      name: "MobileRequestTimeoutError",
      message: "Location evidence is taking too long to load."
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await timeoutRejection;
    expect(stalledFetch).toHaveBeenCalledWith(
      "https://dayframe.test/api/review/review-1/location-evidence",
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        headers: { Authorization: "Bearer session-token" }
      })
    );

    const controller = new AbortController();
    const cancelled = fetchLocationReviewEvidence("review-2", {
      signal: controller.signal
    });
    controller.abort(new Error("Route exited."));
    await expect(cancelled).rejects.toThrow("Route exited.");
  });

  it("bounds direct-only location actions and keeps native network errors friendly", async () => {
    vi.useFakeTimers();
    storeBoundSession("session-token");
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    const request = resolveLocationReviewItem("review-1", {
      action: "record_poi_once",
      name: "Cafe"
    });
    const rejection = expect(request).rejects.toMatchObject({
      name: "MobileRequestTimeoutError",
      message: "This location Review action is taking too long. Your changes are still here."
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;

    expect(normaliseLocationReviewRequestError(
      new Error("ExpoModulesCore.UnexpectedException: Network request failed"),
      "action"
    )).toBe("This action needs a connection and could not be completed. Your changes are still here.");
  });

  it("invalidates the current bearer when location evidence returns 401", async () => {
    storeBoundSession("expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required" }, 401))));

    await expect(fetchLocationReviewEvidence("review-1")).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("ignores a delayed bootstrap rejection from the session replaced during the request", async () => {
    await setSessionToken("account-a-token", TIMER_STOP_OWNER);
    let finishResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finishResponse = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const staleBootstrap = fetchBootstrap();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await setSessionToken("account-b-token", ACCOUNT_B_OWNER);
    finishResponse?.(jsonResponse({ error: "Login required" }, 401));

    await expect(staleBootstrap).rejects.toBeInstanceOf(StaleMobileSessionResponseError);
    await expect(getSessionToken()).resolves.toBe("account-b-token");
  });

  it("ignores a delayed successful bootstrap from the account replaced during the request", async () => {
    await setSessionToken("account-a-token", TIMER_STOP_OWNER);
    let finishResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finishResponse = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const staleBootstrap = fetchBootstrap();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await setSessionToken("account-b-token", ACCOUNT_B_OWNER);
    finishResponse?.(jsonResponse({ reviewItems: [] }));

    await expect(staleBootstrap).rejects.toBeInstanceOf(StaleMobileSessionResponseError);
    await expect(getSessionToken()).resolves.toBe("account-b-token");
  });

  it("requests bootstrap data for a selected date", async () => {
    storeBoundSession("session-token");
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

  it("requests a no-store timer fingerprint with the bearer session", async () => {
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      activeEntryId: "entry-1",
      updatedAt: "2026-07-30T15:00:00.000Z",
      serverNow: "2026-07-30T15:00:03.000Z"
    })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchTimerState()).resolves.toEqual({
      activeEntryId: "entry-1",
      updatedAt: "2026-07-30T15:00:00.000Z",
      serverNow: "2026-07-30T15:00:03.000Z"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/timer-state",
      {
        headers: { Authorization: "Bearer session-token" },
        cache: "no-store",
        credentials: "omit"
      }
    );
  });

  it("clears the bearer session when the timer-state check returns 401", async () => {
    storeBoundSession("expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required" }, 401))));

    await expect(fetchTimerState()).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("fails closed when migrating an old unscoped queued timer Stop", async () => {
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
        failureCount: 1,
        failureKind: "permanent",
        lastError: "Legacy timer Stop has no canonical target and cannot be replayed safely.",
        source: "mobile_app",
        type: "timer_stop",
        localId: "local-1",
        queuedAt: "2026-07-06T08:16:00.000Z",
        rawPayload: { order: 1 }
      })
    );
    expect(queue[0].occurredAt.toISOString()).toBe("2026-07-06T08:15:00.000Z");
  });

  it("delivers one durable entry-scoped Stop with its original identity and timestamp", async () => {
    storeBoundSession("session-token");
    const pending = await getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A },
      occurredAt: "2026-08-19T09:00:00.000Z"
    });
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      eventId: "event-stop",
      outcome: "stopped"
    }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deliverPendingTimerStop(pending, TIMER_STOP_OWNER)).resolves.toMatchObject({
      status: "delivered"
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://dayframe.test/api/events");
    expect(init).toEqual(expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer session-token" })
    }));
    expect(body).toEqual({
      clientEventId: pending.clientEventId,
      occurredAt: "2026-08-19T09:00:00.000Z",
      rawPayload: {
        origin: "mobile_timer_stop",
        stopScope: "entry",
        targetEntryId: TIMER_TARGET_A
      },
      source: "mobile_app",
      type: "timer_stop"
    });
    await expect(readPendingTimerStops()).resolves.toEqual([]);
  });

  it("retains timer_busy and retries with the same Stop idempotency key", async () => {
    storeBoundSession("session-token");
    const pending = await getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A },
      occurredAt: "2026-08-19T09:05:00.000Z"
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ code: "timer_busy", error: "Timer is busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ eventId: "event-stop", duplicate: true }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deliverPendingTimerStop(pending, TIMER_STOP_OWNER)).resolves.toMatchObject({
      status: "retryable_failure",
      pendingStop: { failureCount: 1, failureKind: "retryable", lastStatusCode: 503 }
    });
    const retained = (await readPendingTimerStops())[0];
    await expect(deliverPendingTimerStop(retained, TIMER_STOP_OWNER)).resolves.toMatchObject({
      status: "delivered"
    });
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));
    expect(bodies.map((body) => body.clientEventId)).toEqual([
      pending.clientEventId,
      pending.clientEventId
    ]);
    expect(bodies.map((body) => body.occurredAt)).toEqual([
      pending.occurredAt,
      pending.occurredAt
    ]);
  });

  it("keeps a permanent Stop rejection visible without converting it to offline success", async () => {
    storeBoundSession("session-token");
    const pending = await getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A }
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(
      jsonResponse({ error: "Invalid target" }, 422)
    )));

    await expect(deliverPendingTimerStop(pending, TIMER_STOP_OWNER)).resolves.toMatchObject({
      status: "permanent_failure",
      pendingStop: { failureKind: "permanent", lastStatusCode: 422 }
    });
    await expect(readPendingTimerStops()).resolves.toEqual([
      expect.objectContaining({ clientEventId: pending.clientEventId, failureKind: "permanent" })
    ]);
  });

  it("reports the exact newly rejected Stop for safe optimistic rollback", async () => {
    storeBoundSession("session-token");
    const pending = await getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A }
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(
      jsonResponse({ error: "Invalid target" }, 422)
    )));

    await expect(synchronisePendingTimerStops({
      correlations: new Map(),
      owner: TIMER_STOP_OWNER
    })).resolves.toMatchObject({
      deliveredCount: 0,
      needsAttentionCount: 1,
      permanentRejectedCount: 1,
      permanentRejectedClientEventIds: [pending.clientEventId],
      remaining: [expect.objectContaining({
        clientEventId: pending.clientEventId,
        failureKind: "permanent"
      })],
      transportFailure: false
    });
  });

  it("does not deliver another account's pending Stop", async () => {
    const pending = await getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(deliverPendingTimerStop(pending, {
      userId: "user-b",
      workspaceId: "workspace-b"
    })).resolves.toMatchObject({ status: "account_mismatch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send an owned Stop after the active mobile account changes", async () => {
    const pending = await getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A }
    });
    await activateMobileAccount({ userId: "user-b", workspaceId: "workspace-b" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(deliverPendingTimerStop(pending, TIMER_STOP_OWNER))
      .resolves.toMatchObject({ status: "session_changed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not dispatch an account A Stop when the deferred token read switches to account B", async () => {
    let finishTokenRead: ((token: string | null) => void) | undefined;
    vi.mocked(SecureStore.getItemAsync).mockImplementationOnce(() =>
      new Promise<string | null>((resolve) => {
        finishTokenRead = resolve;
      })
    );
    const pending = await getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const delivery = deliverPendingTimerStop(pending, TIMER_STOP_OWNER);
    await vi.waitFor(() => expect(finishTokenRead).toBeTypeOf("function"));
    const replacementLogin = setSessionToken("account-b-token", ACCOUNT_B_OWNER);
    finishTokenRead?.("account-a-token");

    await expect(delivery).resolves.toMatchObject({ status: "session_changed" });
    await replacementLogin;
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(getSessionToken()).resolves.toBe("account-b-token");
    await expect(readPendingTimerStops()).resolves.toEqual([
      expect.objectContaining({ clientEventId: pending.clientEventId })
    ]);
  });

  it("bounds mobile Stop delivery at eight seconds and retains it for retry", async () => {
    vi.useFakeTimers();
    storeBoundSession("session-token");
    const pending = await getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A }
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));

    const delivery = deliverPendingTimerStop(pending, TIMER_STOP_OWNER);
    await vi.advanceTimersByTimeAsync(7_999);
    expect((await readPendingTimerStops())[0]?.failureCount).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await expect(delivery).resolves.toMatchObject({ status: "retryable_failure" });
    await expect(readPendingTimerStops()).resolves.toEqual([
      expect.objectContaining({
        clientEventId: pending.clientEventId,
        failureKind: "retryable",
        lastError: "Timer Stop is still pending. Dayframe will retry automatically."
      })
    ]);
  });

  it("migrates stale queue workspace fields without losing Health payload details", async () => {
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        storedQueuedEvent({
          source: "health_sleep",
          type: "health_sleep_import",
          workspaceId: TIMER_STOP_OWNER.workspaceId,
          userId: TIMER_STOP_OWNER.userId,
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
    expect(queue[0]).toMatchObject(TIMER_STOP_OWNER);
    expect((queue[0] as Record<string, unknown>).clientEventId).toBeUndefined();
    expect(queue[0].rawPayload).toEqual({
      provider: "healthkit",
      externalSampleId: "sleep-sample-1",
      workspaceId: "00000000-0000-4000-8000-000000000010"
    });
  });

  it("syncs a queued Health event without posting stale client workspace fields", async () => {
    storeBoundSession("session-token");
    asyncStore.set(
      "dayframe.offlineQueue.v1",
      JSON.stringify([
        storedQueuedEvent({
          localId: "local-health-sleep-1",
          source: "health_sleep",
          type: "health_sleep_import",
          workspaceId: TIMER_STOP_OWNER.workspaceId,
          userId: TIMER_STOP_OWNER.userId,
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

  it("converges an offline timer Start from local projection to one canonical server entry", async () => {
    storeBoundSession("session-token");
    const localId = "optimistic-active-timer:offline-1";
    const canonicalId = "entry-canonical-1";
    await enqueueEvent({
      localId,
      source: "mobile_app",
      type: "timer_start",
      description: "Offline work"
    });

    const offlineProjection = projectDurableLocalWork(timerRecoveryBootstrap(), {
      owner: TIMER_STOP_OWNER,
      activityEvents: await readQueue(),
      correlations: new Map(),
      timeEntryCommands: [],
      timerStops: []
    });
    expect(offlineProjection.activeEntry).toMatchObject({
      id: localId,
      description: "Offline work"
    });

    let canonicalServerEntry: MobileBootstrap["activeEntry"] = null;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { clientEventId?: string };
      expect(body.clientEventId).toBe(localId);
      canonicalServerEntry = timerRecoveryEntry(canonicalId);
      return Promise.resolve(jsonResponse({
        eventId: "event-start-1",
        timeEntryId: canonicalId
      }, 201));
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.synced).toEqual([localId]);
    expect(result.timerEntryIdCorrelations).toEqual([{
      localId,
      timeEntryId: canonicalId
    }]);
    const correlations = await readTimerEntryIdCorrelations();
    expect(correlations).toEqual(new Map([[localId, canonicalId]]));
    await expect(readQueue()).resolves.toEqual([]);

    const converged = projectDurableLocalWork(
      timerRecoveryBootstrap(canonicalServerEntry),
      {
        owner: TIMER_STOP_OWNER,
        activityEvents: await readQueue(),
        correlations,
        timeEntryCommands: [],
        timerStops: []
      }
    );
    expect(converged.activeEntry?.id).toBe(canonicalId);
    expect(converged.entries).toEqual([
      expect.objectContaining({ id: canonicalId, description: "Offline work" })
    ]);
    expect(converged.entries.some((entry) => entry.id === localId)).toBe(false);

    await expect(removeTimerEntryIdCorrelation(localId))
      .resolves.toBe(true);
    await expect(readTimerEntryIdCorrelations()).resolves.toEqual(new Map());
  });

  it("keeps a timer start queued when a successful response omits canonical correlation", async () => {
    storeBoundSession("session-token");
    await enqueueEvent({
      localId: "optimistic-active-timer:missing-correlation",
      source: "mobile_app",
      type: "timer_start"
    });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({
      eventId: "event-start-without-entry"
    }, 200))));

    const result = await syncQueue();

    expect(result.synced).toEqual([]);
    expect(result.timerEntryIdCorrelations).toEqual([]);
    expect(result.remaining.map((event) => event.localId)).toEqual([
      "optimistic-active-timer:missing-correlation"
    ]);
  });

  it.each(["suggestion", "stop", "delete"] as const)(
    "retargets an accepted %s after an in-flight offline start syncs to its canonical ID",
    async (action) => {
      const optimisticId = `optimistic-active-timer:in-flight-${action}`;
      const canonicalId = `entry-canonical-${action}`;
      storeBoundSession("session-token");
      await enqueueEvent({
        localId: optimisticId,
        source: "mobile_app",
        type: "timer_start",
        description: "Original offline title"
      });

      const startResponse = deferred<Response>();
      let serverActiveEntry: { id: string; description: string | null } | null = null;
      const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/events") && method === "POST") {
          return startResponse.promise;
        }
        if (url.includes(`/api/time-entries/${canonicalId}`) && method === "PATCH") {
          const patch = JSON.parse(String(init?.body)) as { description?: string | null };
          serverActiveEntry = serverActiveEntry
            ? { ...serverActiveEntry, description: patch.description ?? null }
            : null;
          return jsonResponse({ ok: true });
        }
        if (url.endsWith("/api/time-entries") && method === "POST") {
          const body = JSON.parse(String(init?.body)) as { mode?: string };
          if (body.mode === "stop") serverActiveEntry = null;
          return jsonResponse({ eventId: "event-stop", timeEntryId: canonicalId });
        }
        if (url.includes(`/api/time-entries/${canonicalId}`) && method === "DELETE") {
          serverActiveEntry = null;
          return jsonResponse({ ok: true });
        }
        if (url.includes("/api/bootstrap")) {
          return jsonResponse({
            activeEntry: serverActiveEntry,
            entries: serverActiveEntry ? [serverActiveEntry] : []
          });
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      // This intentionally bypasses Dashboard's local persistence queue, just
      // like Settings retry does. The API barrier must still retarget the
      // dependent action after syncQueue records O -> C.
      const syncCompletion = syncQueue();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      let dependentPersistenceApplied = false;
      const dependentCompletion = (async () => {
        const persistedId = await resolveTimerEntryIdAfterQueueBarrier(optimisticId);
        dependentPersistenceApplied = true;
        if (action === "suggestion") {
          if (persistedId) {
            await updateTimeEntry(persistedId, { description: "Accepted suggestion" });
          } else {
            await requireQueuedTimerStartUpdate(() => updateQueuedTimerStart(
              optimisticId,
              { description: "Accepted suggestion" }
            ));
          }
          return;
        }
        if (action === "stop") {
          if (persistedId) {
            await stopTimer();
          } else {
            await requireQueuedTimerStartUpdate(() => updateQueuedTimerStart(optimisticId, {}));
            throw new Error("Expected the timer start correlation before Stop");
          }
          return;
        }
        if (persistedId) {
          await deleteTimeEntry(persistedId);
          await removeTimerEntryIdCorrelation(optimisticId);
        } else {
          await requireQueuedTimerStartRemoval(() => removeQueuedEvent(optimisticId));
        }
      })();

      await Promise.resolve();
      expect(dependentPersistenceApplied).toBe(false);
      await expect(readQueue()).resolves.toEqual([
        expect.objectContaining({ localId: optimisticId, type: "timer_start" })
      ]);

      serverActiveEntry = { id: canonicalId, description: "Original offline title" };
      startResponse.resolve(jsonResponse({
        eventId: `event-${action}`,
        timeEntryId: canonicalId
      }, 201));
      await Promise.all([syncCompletion, dependentCompletion]);

      expect(dependentPersistenceApplied).toBe(true);
      await expect(readQueue()).resolves.toEqual([]);
      if (action === "suggestion") {
        expect(fetchMock).toHaveBeenCalledWith(
          `https://dayframe.test/api/time-entries/${canonicalId}`,
          expect.objectContaining({
            body: JSON.stringify({ description: "Accepted suggestion" }),
            method: "PATCH"
          })
        );
      } else if (action === "stop") {
        expect(fetchMock).toHaveBeenCalledWith(
          "https://dayframe.test/api/time-entries",
          expect.objectContaining({
            body: expect.stringContaining('"mode":"stop"'),
            method: "POST"
          })
        );
      } else {
        expect(fetchMock).toHaveBeenCalledWith(
          `https://dayframe.test/api/time-entries/${canonicalId}`,
          expect.objectContaining({ method: "DELETE" })
        );
        await expect(readTimerEntryIdCorrelations()).resolves.toEqual(new Map());
      }

      const firstRefresh = await fetchBootstrap();
      const secondRefresh = await fetchBootstrap();
      if (action === "suggestion") {
        expect(firstRefresh.activeEntry).toEqual({
          id: canonicalId,
          description: "Accepted suggestion"
        });
        expect(secondRefresh.activeEntry).toEqual(firstRefresh.activeEntry);
      } else {
        expect(firstRefresh.activeEntry).toBeNull();
        expect(secondRefresh.activeEntry).toBeNull();
      }
    }
  );

  it("hydrates an externally synced canonical alias before active-deletion collision classification", async () => {
    const optimisticId = "optimistic-active-timer:settings-sync-deletion";
    const canonicalId = "entry-settings-sync-deletion";
    storeBoundSession("session-token");
    await enqueueEvent({
      localId: optimisticId,
      source: "mobile_app",
      type: "timer_start"
    });
    const startResponse = deferred<Response>();
    const fetchMock = vi.fn(() => startResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    let now = 1_000;
    let restoredId: string | null = null;
    const commits = vi.fn();
    const reconciler = createOptimisticTimerStartReconciler();
    reconciler.begin(optimisticId);
    reconciler.settle(optimisticId, "queued");
    const coordinator = createDeletionCoordinator<
      { id: string },
      { activeEntry: { id: string } | null }
    >({
      clearTimer: () => undefined,
      now: () => now,
      onCommit: commits,
      onPendingChange: () => undefined,
      onRestore: () => {
        restoredId = canonicalId;
      },
      setTimer: () => 1
    });
    const prepared = coordinator.prepare(
      [{ id: optimisticId }],
      { activeEntry: { id: optimisticId } }
    );
    if (!prepared) throw new Error("Expected prepared deletion");
    coordinator.activate(prepared.token);

    // Settings owns this direct sync; Dashboard has not entered its local
    // mutation queue and must discover the durable alias at poll time.
    const settingsSync = syncQueue();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    let pollResolved = false;
    const pollTombstones = (async () => {
      const durableId = await resolveTimerEntryIdAfterQueueBarrier(optimisticId);
      if (durableId) {
        coordinator.registerPendingId(prepared.token, durableId);
        reconciler.settle(optimisticId, "persisted");
      }
      const pendingIds = coordinator.pendingEntryIds();
      if (!reconciler.deferExternalActiveEntry({
        deletedActiveEntryId: optimisticId,
        externalActiveEntryId: canonicalId,
        pendingEntryIds: pendingIds
      })) {
        coordinator.reconcileExternalActiveEntry({
          deletedActiveEntryId: optimisticId,
          externalActiveEntryId: canonicalId
        });
      }
      pollResolved = true;
      return coordinator.pendingEntryIds();
    })();

    await Promise.resolve();
    expect(pollResolved).toBe(false);
    startResponse.resolve(jsonResponse({
      eventId: "event-settings-sync-deletion",
      timeEntryId: canonicalId
    }, 201));
    await settingsSync;
    const tombstones = await pollTombstones;

    expect(tombstones).toEqual(new Set([optimisticId, canonicalId]));
    expect(tombstones.has(canonicalId)).toBe(true);
    expect(commits).not.toHaveBeenCalled();
    now = 5_999;
    expect(coordinator.undo(prepared.token)).toBe(true);
    expect(restoredId).toBe(canonicalId);
  });

  it("persists a dedicated Stop while the general queue is in flight", async () => {
    const optimisticId = "optimistic-active-timer:queue-lock";
    storeBoundSession("session-token");
    await enqueueEvent({
      localId: optimisticId,
      source: "mobile_app",
      type: "timer_start"
    });
    const startResponse = deferred<Response>();
    const fetchMock = vi.fn(() => startResponse.promise);
    vi.stubGlobal("fetch", fetchMock);

    const syncCompletion = syncQueue();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const stopEnqueue = getOrCreatePendingStop({
      owner: TIMER_STOP_OWNER,
      target: { targetEntryId: TIMER_TARGET_A }
    });
    let stopEnqueued = false;
    void stopEnqueue.then(() => {
      stopEnqueued = true;
    });

    await stopEnqueue;
    expect(stopEnqueued).toBe(true);
    startResponse.resolve(jsonResponse({
      eventId: "event-queue-lock",
      timeEntryId: "entry-queue-lock"
    }, 201));
    await Promise.all([syncCompletion, stopEnqueue]);

    await expect(readQueue()).resolves.toEqual([]);
    await expect(readPendingTimerStops()).resolves.toEqual([
      expect.objectContaining({ targetEntryId: TIMER_TARGET_A })
    ]);
  });

  it("shares an in-flight activity drain while allowing a new Start to become durable", async () => {
    storeBoundSession("session-token");
    await enqueueEvent({
      localId: "optimistic-active-timer:first",
      source: "mobile_app",
      type: "timer_start"
    });
    const firstResponse = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValue(jsonResponse({
        eventId: "event-second",
        timeEntryId: "entry-second"
      }, 201));
    vi.stubGlobal("fetch", fetchMock);

    const firstDrain = syncQueue();
    const sharedDrain = syncQueue();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    await expect(enqueueEvent({
      localId: "optimistic-active-timer:second",
      source: "mobile_app",
      type: "timer_start"
    })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ localId: "optimistic-active-timer:second" })
    ]));
    await expect(readQueue()).resolves.toHaveLength(2);

    firstResponse.resolve(jsonResponse({
      eventId: "event-first",
      timeEntryId: "entry-first"
    }, 201));
    const results = await Promise.all([firstDrain, sharedDrain]);
    expect(results).toEqual([
      expect.objectContaining({
        synced: ["optimistic-active-timer:first"],
        remainingCount: 1
      }),
      expect.objectContaining({
        synced: ["optimistic-active-timer:first"],
        remainingCount: 1
      })
    ]);
    await expect(readQueue()).resolves.toEqual([
      expect.objectContaining({ localId: "optimistic-active-timer:second" })
    ]);

    await expect(syncQueue()).resolves.toMatchObject({
      synced: ["optimistic-active-timer:second"],
      remainingCount: 0
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves queue order when the first event fails to sync", async () => {
    storeBoundSession("session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload({ order: 1 }) });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload({ order: 2 }) });
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "Server error" }, 500)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.synced).toEqual([]);
    expect(result.remaining).toHaveLength(2);
    expect(result.remaining[0].rawPayload).toEqual(scopedStopPayload({ order: 1 }));
    expect(result.remaining[1].rawPayload).toEqual(scopedStopPayload({ order: 2 }));
    expect(result.failedCount).toBe(1);
    expect(result.firstError?.message).toBe("Server error");
  });

  it("dedupes queued events that reuse a deterministic local id", async () => {
    await enqueueEvent({ localId: "location-visit-1", source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload() });
    await enqueueEvent({ localId: "location-visit-1", source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload() });

    const queue = await readQueue();

    expect(queue).toHaveLength(1);
    expect(queue[0].localId).toBe("location-visit-1");
  });

  it("keeps edited tag associations on an offline queued timer start", async () => {
    await enqueueEvent({
      localId: "offline-tagged-timer",
      source: "mobile_app",
      type: "timer_start",
      description: "Plan #planning",
      rawPayload: { origin: "mobile_home" }
    });

    await updateQueuedTimerStart("offline-tagged-timer", {
      description: "Plan #planning #deep-work",
      tagNames: ["Planning", "Deep work"]
    });

    const queue = await readQueue();
    expect(queue[0].description).toBe("Plan #planning #deep-work");
    expect(queue[0].rawPayload).toEqual({
      origin: "mobile_home",
      tagNames: ["Planning", "Deep work"]
    });
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
    storeBoundSession("session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload({ order: 1 }) });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload({ order: 2 }) });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ eventId: "event-1", duplicate: true }, 200))
      .mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncQueue();

    expect(result.synced).toHaveLength(1);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0].rawPayload).toEqual(scopedStopPayload({ order: 2 }));
  });

  it("records validation failures and continues syncing later valid events", async () => {
    storeBoundSession("session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload({ order: 1 }) });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload({ order: 2 }) });
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
        rawPayload: scopedStopPayload({ order: 1 })
      })
    );
    expect(result.failedCount).toBe(1);
    expect(getQueueDiagnostics(result.remaining).clearableFailedCount).toBe(1);
  });

  it("keeps network failures queued for retry with failure metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:20:00.000Z"));
    storeBoundSession("session-token");
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload({ offline: true }) });
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
    expect(persisted[0].rawPayload).toEqual(scopedStopPayload({ offline: true }));
  });

  it("respects retry backoff before automatic queue sync tries a failed item again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T08:20:00.000Z"));
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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
    storeBoundSession("expired-token");
    await expect(readAuthenticatedSessionSnapshot()).resolves.toMatchObject({
      status: "authenticated",
      snapshot: { owner: TIMER_STOP_OWNER, token: "expired-token" }
    });
    await expect(readOwnedAuthenticatedSessionSnapshot(TIMER_STOP_OWNER)).resolves.toMatchObject({
      status: "authenticated"
    });
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload() });
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required" }, 401)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncQueue()).rejects.toBeInstanceOf(AuthRequiredError);
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(getSessionToken()).resolves.toBeNull();
    await expect(readQueue()).resolves.toHaveLength(1);
  });

  it("never sends account A durable work with account B's restored bearer", async () => {
    await setSessionToken("account-b-token", ACCOUNT_B_OWNER);
    await enqueueEvent({
      source: "mobile_app",
      type: "timer_stop",
      rawPayload: scopedStopPayload()
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncQueue()).resolves.toMatchObject({
      stopped: true,
      syncedCount: 0,
      remainingCount: 1
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(readQueue(TIMER_STOP_OWNER)).resolves.toHaveLength(1);
  });

  it("blocks direct timer actions while the restored bearer owner disagrees", async () => {
    await setSessionToken("account-b-token", ACCOUNT_B_OWNER);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(startTimer(null, "Wrong account"))
      .rejects.toBeInstanceOf(StaleMobileSessionResponseError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains a replacement login when queued sync receives a delayed old-session 401", async () => {
    await setSessionToken("account-a-token", TIMER_STOP_OWNER);
    await enqueueEvent({ source: "mobile_app", type: "timer_stop", rawPayload: scopedStopPayload() });
    let finishResponse: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      finishResponse = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);

    const staleSync = syncQueue();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await setSessionToken("account-b-token", ACCOUNT_B_OWNER);
    finishResponse?.(jsonResponse({ error: "Login required" }, 401));

    const result = await staleSync;
    expect(result).toMatchObject({ stopped: true, syncedCount: 0, remainingCount: 1 });
    await expect(getSessionToken()).resolves.toBe("account-b-token");
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
    storeBoundSession("session-token");
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
      timerEntryIdCorrelations: [],
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
        occurredAt: "2026-07-06T08:15:00.000Z"
      })
    );
    expect(snapshot.queue[0].rawPayload).toEqual(
      expect.objectContaining({ origin: "shortcut" })
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
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      eventId: "event-1",
      timeEntryId: "entry-1"
    }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startTimer(
      "20000000-0000-4000-8000-000000000001",
      "Write notes"
    )).resolves.toMatchObject({ timeEntryId: "entry-1" });

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
    storeBoundSession("session-token");
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

  it("starts a bare uncategorized timer without a description", async () => {
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await startTimer(null, "   ");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "start",
          source: "mobile_app"
        })
      })
    );
  });

  it("starts timers at a user-selected start time", async () => {
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await startTimer(null, "Backfilled task", "2026-07-12T12:15:00.000Z");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "start",
          source: "mobile_app",
          description: "Backfilled task",
          startedAt: "2026-07-12T12:15:00.000Z"
        })
      })
    );
  });

  it("omits blank timer descriptions from mobile starts", async () => {
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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

  it("creates tags immediately through the hosted API", async () => {
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({
      ok: true,
      tag: {
        id: "50000000-0000-4000-8000-000000000001",
        name: "Planning",
        normalizedName: "planning"
      }
    }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createTag("Planning");

    expect(result.tag.normalizedName).toBe("planning");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/tags",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Planning" })
      })
    );
  });

  it("updates category name, color and pin state through the hosted API", async () => {
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await archiveCategory("20000000-0000-4000-8000-000000000001");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/categories?id=20000000-0000-4000-8000-000000000001",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("creates places through the hosted API without auto-start", async () => {
    storeBoundSession("session-token");
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
            autoStart: false,
            loggingEnabled: true
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

  it("promotes learned places through the hosted places API", async () => {
    storeBoundSession("session-token");
    const savedPlace = {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Office",
      latitude: 51.5,
      longitude: -0.12,
      radiusMeters: 160,
      priority: 5,
      defaultProjectId: null,
      defaultCategoryId: null,
      defaultActivityDescription: null
    };
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, place: savedPlace }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPlace({
      learnedPlaceId: "40000000-0000-4000-8000-000000000001",
      name: "Office",
      latitude: 51.5,
      longitude: -0.12,
      radiusMeters: 160,
      priority: 5
    });

    expect(result.place).toEqual(savedPlace);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/places",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Office",
          latitude: 51.5,
          longitude: -0.12,
          radiusMeters: 160,
          priority: 5,
          defaultCategoryId: null,
          defaultActivityDescription: null,
          autoStart: false,
          loggingEnabled: true,
          learnedPlaceId: "40000000-0000-4000-8000-000000000001"
        })
      })
    );
  });

  it("ignores learned places through the hosted API", async () => {
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true, id: "learned-1", status: "ignored" }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await ignoreLearnedPlace("40000000-0000-4000-8000-000000000001");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/learned-places",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          id: "40000000-0000-4000-8000-000000000001",
          status: "ignored"
        })
      })
    );
  });

  it("updates places through the hosted API without project fields", async () => {
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await deletePlace("30000000-0000-4000-8000-000000000001");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/places?id=30000000-0000-4000-8000-000000000001",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("deletes running time entries through the hosted API without queueing", async () => {
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await updateTimeEntry("entry-1", {
      categoryId: "20000000-0000-4000-8000-000000000001",
      description: "Write review notes",
      startedAt: "2026-07-06T08:15:00.000Z",
      tagNames: ["Planning"]
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
          startedAt: "2026-07-06T08:15:00.000Z",
          tagNames: ["Planning"]
        })
      })
    );
    expect(asyncStore.get("dayframe.offlineQueue.v1")).toBeUndefined();
  });

  it("creates manual time entries for edited suggestions", async () => {
    storeBoundSession("session-token");
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

  it("sends explicit blank manual-entry fields and an empty tag set", async () => {
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 201)));
    vi.stubGlobal("fetch", fetchMock);

    await createManualTimeEntry({
      categoryId: null,
      description: "   ",
      startedAt: "2026-08-04T09:00:00.000Z",
      stoppedAt: "2026-08-04T09:30:00.000Z",
      tagNames: []
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/time-entries",
      expect.objectContaining({
        body: JSON.stringify({
          mode: "manual",
          categoryId: null,
          description: null,
          tagNames: [],
          startedAt: "2026-08-04T09:00:00.000Z",
          stoppedAt: "2026-08-04T09:30:00.000Z"
        })
      })
    );
  });

  it("confirms and dismisses review items through the hosted API", async () => {
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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
            message: "Left in Review: automatic logging paused because this overlaps stale open timer \"BAU\" with no stop time. You can still confirm it."
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
    storeBoundSession("session-token");
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
    storeBoundSession("session-token");
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

  it("saves edited review items with one atomic review transaction", async () => {
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await saveEditedReviewItem("review-1", {
      categoryId: null,
      description: "Adjusted suggestion",
      startedAt: "2026-07-07T09:15:00.000Z",
      stoppedAt: "2026-07-07T10:10:00.000Z"
    }, {
      atomicLocation: true,
      clientMutationId: "d87c35ce-2a63-4e44-a8fc-4370f2a5cda4"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/review/review-1",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          clientMutationId: "d87c35ce-2a63-4e44-a8fc-4370f2a5cda4",
          mutation: {
            action: "edit_and_confirm",
            edit: {
              categoryId: null,
              description: "Adjusted suggestion",
              startedAt: "2026-07-07T09:15:00.000Z",
              stoppedAt: "2026-07-07T10:10:00.000Z"
            }
          }
        })
      })
    );
  });

  it("uses the same atomic review operation outside Location V2", async () => {
    storeBoundSession("session-token");
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    vi.stubGlobal("fetch", fetchMock);

    await saveEditedReviewItem("legacy-review", {
      categoryId: null,
      description: "Legacy suggestion",
      startedAt: "2026-07-07T09:15:00.000Z",
      stoppedAt: "2026-07-07T10:10:00.000Z"
    }, {
      clientMutationId: "e87c35ce-2a63-4e44-a8fc-4370f2a5cda4"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://dayframe.test/api/review/legacy-review",
      expect.objectContaining({
        body: expect.stringContaining('"action":"edit_and_confirm"')
      })
    );
  });

  it("clears the session token when deleting a time entry returns 401", async () => {
    storeBoundSession("expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required." }, 401))));

    await expect(deleteTimeEntry("entry-1")).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("clears the session token when updating a time entry returns 401", async () => {
    storeBoundSession("expired-token");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse({ error: "Login required." }, 401))));

    await expect(updateTimeEntry("entry-1", { startedAt: "2026-07-06T08:15:00.000Z" })).rejects.toBeInstanceOf(AuthRequiredError);
    await expect(getSessionToken()).resolves.toBeNull();
  });

  it("recognizes network failures as timer-queue fallback candidates", () => {
    expect(isNetworkTimerError(new TypeError("Network request failed"))).toBe(true);
    expect(isNetworkTimerError(new Error("Timer action failed: 500"))).toBe(false);
  });
});

function timerRecoveryBootstrap(
  activeEntry: MobileBootstrap["activeEntry"] = null
): MobileBootstrap {
  return {
    user: { id: TIMER_STOP_OWNER.userId, email: "a@example.com", name: "A" },
    workspace: { id: TIMER_STOP_OWNER.workspaceId, name: "A" },
    activeEntry,
    projects: [],
    categories: [],
    entries: activeEntry ? [activeEntry] : [],
    places: [],
    reviewItems: []
  };
}

function timerRecoveryEntry(id: string): NonNullable<MobileBootstrap["activeEntry"]> {
  return {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    placeName: null,
    source: "mobile_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Offline work",
    startedAt: "2026-08-22T10:00:00.000Z",
    stoppedAt: null,
    durationSeconds: 0,
    tagNames: []
  };
}

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
  const item = {
    source: "mobile_app",
    type: "timer_stop",
    occurredAt: "2026-07-06T08:15:00.000Z",
    localId: "local-1",
    queuedAt: "2026-07-06T08:16:00.000Z",
    rawPayload: scopedStopPayload(),
    ...overrides
  };
  if (item.type === "timer_stop") {
    item.rawPayload = scopedStopPayload(
      item.rawPayload && typeof item.rawPayload === "object" && !Array.isArray(item.rawPayload)
        ? item.rawPayload as Record<string, unknown>
        : {}
    );
  }
  return item;
}

function scopedStopPayload(extra: Record<string, unknown> = {}) {
  return {
    stopScope: "entry",
    targetEntryId: TIMER_TARGET_A,
    ...extra
  };
}

function readMigratedQueuedEventForTest(item: ReturnType<typeof storedQueuedEvent>, _index: number): QueuedEvent {
  return {
    ...item,
    source: item.source as QueuedEvent["source"],
    type: item.type as QueuedEvent["type"],
    occurredAt: new Date(item.occurredAt),
    userId: "user-test",
    workspaceId: "workspace-test"
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
