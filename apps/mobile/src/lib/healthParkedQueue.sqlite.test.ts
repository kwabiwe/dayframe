import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { HealthCaptureOwner, HealthEpisodeDraft, HealthJournalSample } from "./healthSyncStore";

// A parked Health event against the real Health journal (SQLite) and the real activity queue: Clear
// must not strand its `health_deliveries` row, and the slow retry or Try again settles it (Codex r1 on #547).

const asyncStore = vi.hoisted(() => new Map<string, string>());
const secureStore = vi.hoisted(() => new Map<string, string>());
const sqlite = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: sqlite.open }));
vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "sha256" },
  digestStringAsync: async (_algorithm: string, value: string) => createHash("sha256").update(value).digest("hex")
}));
vi.mock("./location/runtime", () => ({
  bindLocationCaptureOwner: async () => true,
  endLocationCaptureOwnership: async () => undefined,
  beginLocationLogout: () => () => undefined,
  isLocationLogoutCurrent: () => false
}));
vi.mock("./backendIdentity", () => ({ DAYFRAME_BACKEND_ID: "staging-fixture" }));
vi.mock("./reviewNudge", () => ({ cancelReviewNudgeForLogout: async () => undefined, noteReviewCount: async () => undefined }));
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://dayframe.test" }));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { secureStore.set(key, value); },
  deleteItemAsync: async (key: string) => { secureStore.delete(key); }
}));
vi.mock("react-native", () => ({
  AppState: { currentState: "active" },
  NativeModules: {
    DayframeLiveActivityModule: {
      clearRuntimeContext: async () => true,
      clearRuntimeContextIfToken: async () => true,
      setRuntimeContext: async () => true
    }
  },
  Platform: { OS: "ios" }
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStore.get(key) ?? null,
    setItem: async (key: string, value: string) => { asyncStore.set(key, value); },
    removeItem: async (key: string) => { asyncStore.delete(key); }
  }
}));

const owner: HealthCaptureOwner = { backendId: "staging-fixture", workspaceId: "workspace-a", userId: "user-a" };
let db: DatabaseSync;

function adapter() {
  const value = {
    execAsync: async (sql: string) => { db.exec(sql); },
    getFirstAsync: async (sql: string, ...args: never[]) => db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql: string, ...args: never[]) => db.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: never[]) => db.prepare(sql).run(...args),
    withExclusiveTransactionAsync: async (work: (transaction: unknown) => Promise<void>) => {
      db.exec("begin immediate");
      try {
        await work(value);
        db.exec("commit");
      } catch (error) {
        db.exec("rollback");
        throw error;
      }
    }
  };
  return value;
}

function derive(samples: HealthJournalSample[]): HealthEpisodeDraft[] {
  if (!samples.length) return [];
  const startedAt = samples[0].startedAt;
  const stoppedAt = samples.at(-1)!.stoppedAt;
  return [{
    sourceKey: "watch.fixture",
    sampleIds: samples.map((sample) => sample.id),
    startedAt,
    stoppedAt,
    event: {
      source: "health_sleep",
      type: "health_sleep_import",
      occurredAt: new Date(startedAt),
      description: "Sleep",
      rawPayload: { startedAt, stoppedAt, samples: samples.map((sample) => sample.value) }
    }
  }];
}

const deliveryState = () => String(db.prepare("select state from health_deliveries").get()!.state);

beforeEach(() => {
  vi.resetModules();
  asyncStore.clear();
  secureStore.clear();
  db = new DatabaseSync(":memory:");
  sqlite.open.mockResolvedValue(adapter());
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});

describe("parked Health event and its source journal (real SQLite)", () => {
  it("keeps a parked Health event's delivery queued through Clear, then settles it on retry", async () => {
    const store = await import("./healthSyncStore");
    const api = await import("./api");
    const { activateMobileAccount } = await import("./mobileAccount");
    await activateMobileAccount({ userId: owner.userId, workspaceId: owner.workspaceId });
    secureStore.set("dayframe.localSessionToken.v2", JSON.stringify({
      version: 1, token: "session-token", userId: owner.userId, workspaceId: owner.workspaceId
    }));

    const checkpoint = await store.getHealthCheckpoint(owner, "sleep");
    const startedAt = new Date(Date.now() - 5 * 3_600_000).toISOString();
    await store.commitHealthCapturePage({
      owner,
      ...checkpoint,
      previousAnchor: checkpoint.anchor,
      newAnchor: "anchor-1",
      runId: "run-1",
      startedAt: new Date().toISOString(),
      additions: [{
        id: "sleep-sample",
        sourceKey: "watch.fixture",
        startedAt,
        stoppedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
        value: { externalSampleId: "sleep-sample", stage: "asleep_core" }
      }],
      deletedIds: [],
      returnedCount: 1,
      complete: true,
      isCurrent: () => true,
      derive
    });
    await store.handoffHealthEvents(owner, api.enqueueEvent, () => true);
    const [handedOff] = await api.readQueue();
    expect(handedOff.localId).toMatch(/^healthkit:/);
    expect(deliveryState()).toBe("queued");

    // The server keeps answering 500: park it as the cap does (8 replies over a day).
    const raw = JSON.parse(asyncStore.get("dayframe.offlineQueue.v1")!) as Array<Record<string, unknown>>;
    asyncStore.set("dayframe.offlineQueue.v1", JSON.stringify(raw.map((item) => ({
      ...item,
      failedAt: new Date().toISOString(),
      failureKind: "permanent",
      failureCount: 8,
      serverFailureCount: 8,
      firstServerFailureAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
      lastError: "Unable to sync this event. Dayframe stopped retrying it after repeated server errors.",
      lastStatusCode: 500,
      lastAttemptedAt: new Date().toISOString()
    }))));
    expect(api.getQueueDiagnostics(await api.readQueue())).toMatchObject({ permanentFailedCount: 1, clearableFailedCount: 0 });

    // Clear leaves it (and its journal delivery) in place: nothing is stranded.
    await expect(api.clearFailedQueuedEvents()).resolves.toMatchObject({ removedCount: 0 });
    expect((await api.readQueue()).map((item) => item.localId)).toEqual([handedOff.localId]);
    expect(deliveryState()).toBe("queued");

    // Try again (or the slow retry) delivers it with its original ID; the journal settles.
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { clientEventId: string };
      return Promise.resolve(new Response(JSON.stringify({
        eventId: "event-health", clientEventId: body.clientEventId, processingDisposition: "confirmed"
      }), { status: 201, headers: { "Content-Type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.retryFailedQueuedEvents()).resolves.toMatchObject({ synced: [handedOff.localId] });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).clientEventId).toBe(handedOff.localId);
    await expect(api.readQueue()).resolves.toEqual([]);
    expect(deliveryState()).toBe("acknowledged");
  });
});
