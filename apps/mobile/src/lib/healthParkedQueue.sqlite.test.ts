import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { HealthCaptureOwner, HealthEpisodeDraft, HealthJournalSample } from "./healthSyncStore";

// A parked Health event against the real Health journal (SQLite) and the real activity queue. Try again
// (or the slow retry) settles its `health_deliveries` row on acknowledgement (Codex r1 on #547); Clear
// settles it as `discarded` before the queue write, and fails with nothing removed if that settlement
// fails, so the journal is never stranded; a later genuine source change still sends a new revision.

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

const deliveryRows = () => db.prepare(
  "select client_event_id,state,payload_json from health_deliveries order by created_at,client_event_id"
).all() as Array<{ client_event_id: string; state: string; payload_json: string | null }>;
const deliveryState = (clientEventId: string) =>
  deliveryRows().find((row) => row.client_event_id === clientEventId)?.state;

const sleepStartedAt = () => new Date(Date.now() - 5 * 3_600_000).toISOString();

async function signIn() {
  const { activateMobileAccount } = await import("./mobileAccount");
  await activateMobileAccount({ userId: owner.userId, workspaceId: owner.workspaceId });
  secureStore.set("dayframe.localSessionToken.v2", JSON.stringify({
    version: 1, token: "session-token", userId: owner.userId, workspaceId: owner.workspaceId
  }));
}

/** Captures one delta page (journal commit + handoff to the activity queue), as a Health sync pass does. */
async function capture(anchor: string, additions: HealthJournalSample[]) {
  const store = await import("./healthSyncStore");
  const api = await import("./api");
  const checkpoint = await store.getHealthCheckpoint(owner, "sleep");
  await store.commitHealthCapturePage({
    owner,
    ...checkpoint,
    previousAnchor: checkpoint.anchor,
    newAnchor: anchor,
    runId: `run-${anchor}`,
    startedAt: new Date().toISOString(),
    additions,
    deletedIds: [],
    returnedCount: additions.length,
    complete: true,
    isCurrent: () => true,
    derive
  });
  await store.handoffHealthEvents(owner, api.enqueueEvents, () => true);
}

function sleepSample(id: string, startedAt: string, hours: number): HealthJournalSample {
  return {
    id,
    sourceKey: "watch.fixture",
    startedAt,
    stoppedAt: new Date(new Date(startedAt).getTime() + hours * 3_600_000).toISOString(),
    value: { externalSampleId: id, stage: "asleep_core" }
  };
}

/** The server kept answering 500: park every queued event as the cap does (8 replies over a day). */
function parkQueue() {
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
}

function acknowledgingFetch() {
  const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { clientEventId: string };
    return Promise.resolve(new Response(JSON.stringify({
      eventId: `event-${body.clientEventId}`, clientEventId: body.clientEventId, processingDisposition: "confirmed"
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const sentClientEventIds = (fetchMock: ReturnType<typeof acknowledgingFetch>) =>
  fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)).clientEventId as string);

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
  it("settles a parked Health event on Try again with its original ID", async () => {
    const api = await import("./api");
    await signIn();
    await capture("anchor-1", [sleepSample("sleep-sample", sleepStartedAt(), 1)]);
    const [handedOff] = await api.readQueue();
    expect(handedOff.localId).toMatch(/^healthkit:/);
    expect(deliveryState(handedOff.localId)).toBe("queued");
    parkQueue();

    const fetchMock = acknowledgingFetch();
    await expect(api.retryFailedQueuedEvents()).resolves.toMatchObject({ synced: [handedOff.localId] });
    expect(sentClientEventIds(fetchMock)).toEqual([handedOff.localId]);
    await expect(api.readQueue()).resolves.toEqual([]);
    expect(deliveryState(handedOff.localId)).toBe("acknowledged");
  });

  it("clears a parked Health event and settles its journal delivery as discarded", async () => {
    const api = await import("./api");
    await signIn();
    await capture("anchor-1", [sleepSample("sleep-sample", sleepStartedAt(), 1)]);
    const [handedOff] = await api.readQueue();
    parkQueue();
    expect(api.getQueueDiagnostics(await api.readQueue())).toMatchObject({
      permanentFailedCount: 1, parkedFailedCount: 1, clearableFailedCount: 1
    });

    await expect(api.clearFailedQueuedEvents()).resolves.toMatchObject({ removedCount: 1, remainingCount: 0 });
    await expect(api.readQueue()).resolves.toEqual([]);
    expect(deliveryRows()).toEqual([{ client_event_id: handedOff.localId, state: "discarded", payload_json: null }]);

    // A later handoff (or capture of the same source facts) never brings the cleared event back.
    const fetchMock = acknowledgingFetch();
    await capture("anchor-2", []);
    await api.syncQueue({ eventScope: "health" });
    await expect(api.readQueue()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails Clear and removes nothing when the journal settlement fails", async () => {
    const api = await import("./api");
    await signIn();
    await capture("anchor-1", [sleepSample("sleep-sample", sleepStartedAt(), 1)]);
    const [handedOff] = await api.readQueue();
    parkQueue();
    db.exec(`create trigger fail_discard before update on health_deliveries when new.state='discarded'
      begin select raise(abort,'journal unavailable'); end`);

    await expect(api.clearFailedQueuedEvents()).rejects.toThrow("journal unavailable");
    expect((await api.readQueue()).map((item) => item.localId)).toEqual([handedOff.localId]);
    expect(deliveryRows()).toEqual([
      { client_event_id: handedOff.localId, state: "queued", payload_json: expect.any(String) }
    ]);

    // Once the journal works again, Clear succeeds.
    db.exec("drop trigger fail_discard");
    await expect(api.clearFailedQueuedEvents()).resolves.toMatchObject({ removedCount: 1 });
    expect(deliveryState(handedOff.localId)).toBe("discarded");
  });

  it("sends a new revision when the cleared episode's source facts later change", async () => {
    const api = await import("./api");
    await signIn();
    const startedAt = sleepStartedAt();
    await capture("anchor-1", [sleepSample("sleep-sample", startedAt, 1)]);
    const [cleared] = await api.readQueue();
    parkQueue();
    await api.clearFailedQueuedEvents();
    expect(deliveryState(cleared.localId)).toBe("discarded");

    // Health adds a later sample to the same night: a genuine source change of that episode.
    await capture("anchor-2", [sleepSample("sleep-sample-2", new Date(new Date(startedAt).getTime() + 3_600_000).toISOString(), 1)]);
    const [revised] = await api.readQueue();
    expect(revised.localId).not.toBe(cleared.localId);
    const episodeOf = (id: string) => id.split(":").slice(0, 3).join(":");
    expect(episodeOf(revised.localId)).toBe(episodeOf(cleared.localId));
    expect(deliveryState(revised.localId)).toBe("queued");

    const fetchMock = acknowledgingFetch();
    await expect(api.syncQueue({ eventScope: "health" })).resolves.toMatchObject({ synced: [revised.localId] });
    expect(sentClientEventIds(fetchMock)).toEqual([revised.localId]);
    await expect(api.readQueue()).resolves.toEqual([]);
    expect(deliveryState(revised.localId)).toBe("acknowledged");
    expect(deliveryState(cleared.localId)).toBe("discarded");
  });
});
