import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { HealthCaptureOwner, HealthEpisodeDraft, HealthJournalSample } from "./healthSyncStore";

// The activity queue and the Health journal share one boundary (Codex r3 on #549): a handoff working
// from an earlier snapshot cannot re-add an event Clear discarded, and the queue never keeps a Health
// event whose journal delivery is settled or gone. Real Health journal (SQLite) and real activity queue;
// synthetic data, mocked network.

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

async function signedInWithCapture() {
  const store = await import("./healthSyncStore");
  const api = await import("./api");
  const { activateMobileAccount } = await import("./mobileAccount");
  await activateMobileAccount({ userId: owner.userId, workspaceId: owner.workspaceId });
  secureStore.set("dayframe.localSessionToken.v2", JSON.stringify({
    version: 1, token: "session-token", userId: owner.userId, workspaceId: owner.workspaceId
  }));
  const checkpoint = await store.getHealthCheckpoint(owner, "sleep");
  await store.commitHealthCapturePage({
    owner, ...checkpoint, previousAnchor: checkpoint.anchor, newAnchor: "anchor-1", runId: "run-1",
    startedAt: new Date().toISOString(),
    additions: [{
      id: "sleep-sample", sourceKey: "watch.fixture",
      startedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
      stoppedAt: new Date(Date.now() - 4 * 3_600_000).toISOString(),
      value: { externalSampleId: "sleep-sample", stage: "asleep_core" }
    }],
    deletedIds: [], returnedCount: 1, complete: true, isCurrent: () => true, derive
  });
  return { store, api };
}

describe("Health journal and activity queue boundary (real SQLite)", () => {
  it("a handoff from an earlier snapshot cannot re-add an event Clear discarded, through logout", async () => {
    const { store, api } = await signedInWithCapture();
    // Interrupted handoff: the event reaches the queue, the journal still reads pending_handoff.
    let checks = 0;
    await store.handoffHealthEvents(owner, api.enqueueEvents, () => ++checks < 2);
    const [queued] = await api.readQueue();
    expect(deliveryState()).toBe("pending_handoff");
    // The server permanently refuses it.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Synthetic refusal" }), {
      status: 422, headers: { "Content-Type": "application/json" }
    })));
    await api.syncQueue({ eventScope: "non_timer", forceRetry: true });
    expect((await api.readQueue())[0]).toMatchObject({ localId: queued.localId, failureKind: "permanent" });
    // A new handoff reads the row, then waits while the person clears the refused event.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reading!: () => void;
    const read = new Promise<void>((resolve) => { reading = resolve; });
    const handoff = store.handoffHealthEvents(owner, (async (inputs: Parameters<typeof api.enqueueEvents>[0]) => {
      reading();
      await gate;
      return api.enqueueEvents(inputs);
    }) as typeof api.enqueueEvents, () => true);
    await read;
    await expect(api.clearFailedQueuedEvents()).resolves.toMatchObject({ removedCount: 1 });
    expect(deliveryState()).toBe("discarded");
    release();
    await handoff;
    expect(await api.readQueue()).toEqual([]);
    // Logout expires the journal; no Health body is left in the queue without its row.
    await store.expireInactiveHealthOwners(async () => ({ keep: null, isCurrent: () => true }));
    expect(db.prepare("select count(*) n from health_deliveries").get()!.n).toBe(0);
    expect(asyncStore.get("dayframe.offlineQueue.v1") ?? "[]").not.toContain("healthkit:");
  });

  it("drops a queued Health event whose journal delivery is settled or gone, without sending it", async () => {
    const { store, api } = await signedInWithCapture();
    await store.handoffHealthEvents(owner, api.enqueueEvents, () => true);
    const [queued] = await api.readQueue();
    // Its journal row is gone (an older build's Clear, then that account's expiry).
    db.exec("delete from health_deliveries");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await api.syncQueue({ eventScope: "non_timer", forceRetry: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await api.readQueue()).map((item) => item.localId)).not.toContain(queued.localId);
    // An acknowledgement that finds no row is settled, not a retryable failure.
    await expect(store.recordHealthAcknowledgement(owner, queued.localId, {
      eventId: "event", clientEventId: queued.localId, processingDisposition: "confirmed"
    })).resolves.toBe(false);
  });
});
