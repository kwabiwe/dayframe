// Protection assertions derived from the saved S1–S6 real-code reproduction.
// Synthetic accounts/locations only; mocks are not native device evidence.
// Exercises the real Expo task bodies (geofence.ts), native drain (runtime.ts) and SQLite store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { decideLocationRollout, segmentStartedAfterSemanticCutover } from "../../../../../apps/web/src/lib/location/location-rollout";

const h = vi.hoisted(() => ({
  open: vi.fn(),
  fetch: vi.fn(),
  tasks: new Map<string, (body: { data: unknown; error: unknown }) => Promise<void>>(),
  asyncStore: new Map<string, string>(),
  secure: new Map<string, string>(),
  nativeSignals: [] as Array<Record<string, unknown>>,
  nativeCalls: [] as string[],
  drain: vi.fn(),
  clearAll: vi.fn(),
  stopExpo: vi.fn(),
  beforeInsert: null as (() => Promise<void>) | null,
  motionStatus: "authorized",
  motionRecords: [] as Array<{ startMs: number; activity: "stationary" | "walking" | "automotive"; confidence: "high" }>,
  queryActivities: vi.fn()
}));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: h.open }));
vi.mock("../config", () => ({ DAYFRAME_API_BASE: "https://fixture.invalid" }));
vi.mock("../secure-session", () => ({
  SecureSessionUnavailableError: class extends Error {},
  invalidateMobileSessionIfCurrent: vi.fn(),
  isAuthenticatedSessionSnapshotCurrent: () => true,
  readOwnedAuthenticatedSessionSnapshot: async () => ({ status: "signed_out" })
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (k: string) => h.secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => { h.secure.set(k, v); })
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.asyncStore.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { h.asyncStore.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { h.asyncStore.delete(k); })
  }
}));
vi.mock("expo-task-manager", () => ({
  defineTask: (name: string, fn: (body: { data: unknown; error: unknown }) => Promise<void>) => { h.tasks.set(name, fn); }
}));
vi.mock("expo-location", () => ({
  GeofencingEventType: { Enter: 1, Exit: 2 },
  Accuracy: { High: 4, Balanced: 3 },
  getLastKnownPositionAsync: vi.fn(async () => null),
  getForegroundPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  getBackgroundPermissionsAsync: vi.fn(async () => ({ status: "granted" })),
  startLocationUpdatesAsync: vi.fn(async () => { h.nativeCalls.push("expo:startLocationUpdates"); }),
  hasStartedGeofencingAsync: vi.fn(async () => true),
  startGeofencingAsync: vi.fn(async (_n: string, regions: Array<{ identifier: string }>) => { h.nativeCalls.push(`expo:startGeofencing:${regions.map((r) => r.identifier).join(",")}`); }),
  stopGeofencingAsync: vi.fn(async () => { h.nativeCalls.push("expo:stopGeofencing"); }),
  hasStartedLocationUpdatesAsync: vi.fn(async () => true),
  stopLocationUpdatesAsync: h.stopExpo
}));
vi.mock("../api", () => ({ enqueueEvent: vi.fn(async () => undefined) }));
vi.mock("../locationGeocoding", () => ({ reverseGeocodeLocation: vi.fn(async () => null) }));
vi.mock("../../../modules/dayframe-location-visits", () => ({
  drainSignals: h.drain,
  clearSignals: vi.fn(async (ids: string[]) => {
    h.nativeCalls.push(`clearSignals:${ids.length}`);
    h.nativeSignals = h.nativeSignals.filter((s) => !ids.includes(s.id as string));
    return ids.length;
  }),
  clearAllSignals: h.clearAll,
  startMonitoring: vi.fn(async () => { h.nativeCalls.push("startMonitoring"); return {}; }),
  stopMonitoring: vi.fn(async () => { h.nativeCalls.push("stopMonitoring"); return {}; }),
  getStatus: vi.fn(async () => ({}))
}));

// Core Motion's history: each record lasts until the next; a query also returns the one in progress at its start.
vi.mock("../../../modules/dayframe-motion-activity", () => ({
  MAX_MOTION_RECORDS_PER_QUERY: 2_000,
  getAuthorizationStatus: () => h.motionStatus,
  queryActivities: h.queryActivities
}));

const A = { userId: "a0000000-0000-4000-8000-00000000000a", workspaceId: "a0000000-0000-4000-8000-0000000000aa" };
const B = { userId: "b0000000-0000-4000-8000-00000000000b", workspaceId: "b0000000-0000-4000-8000-0000000000bb" };
const A_PLACE = "a0000000-0000-4000-8000-00000000a1ce";
const key = (o: typeof A) => `${o.workspaceId}:${o.userId}`;
const bootstrap = (o: typeof A, places: unknown[] = []) => ({
  user: { id: o.userId, email: "x@example.test", name: "x" },
  workspace: { id: o.workspaceId, name: "w" },
  locationRolloutMode: "v2_shadow",
  places,
  learnedPlaces: []
}) as unknown as import("../api").MobileBootstrap;

let db: DatabaseSync;
let store: typeof import("./store");
let runtime: typeof import("./runtime");
let account: typeof import("../mobileAccount");
let geofence: typeof import("../geofence");
function adapter() {
  const value = {
    execAsync: async (sql: string) => { db.exec(sql); },
    getFirstAsync: async (sql: string, ...args: never[]) => db.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql: string, ...args: never[]) => db.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: never[]) => { if (sql.includes("insert or ignore into location_evidence_journal") && h.beforeInsert) await h.beforeInsert(); return db.prepare(sql).run(...args); },
    withExclusiveTransactionAsync: async (fn: (t: unknown) => Promise<void>) => {
      db.exec("BEGIN IMMEDIATE");
      try { await fn(value); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
    }
  };
  return value;
}
const rows = () => db.prepare(
  "select client_evidence_id id, account_key k, occurred_at t, json_extract(evidence_json,'$.deviceId') d, json_extract(evidence_json,'$.savedPlaceId') p from location_evidence_journal order by occurred_at, client_evidence_id"
).all() as Array<{ id: string; k: string; t: string; d: string; p: string | null }>;
const fix = (ms: number, lon = -0.1) => ({ coords: { latitude: 51.5, longitude: lon, accuracy: 5, altitude: 10, speed: 0, heading: 0 }, timestamp: ms });
const learningTask = () => h.tasks.get("DAYFRAME_LOCATION_LEARNING_TASK")!;
const geofenceTask = () => h.tasks.get("DAYFRAME_GEOFENCE_TASK")!;
const T0 = Date.parse("2026-09-30T08:00:00.000Z");

beforeEach(async () => {
  vi.resetModules(); h.tasks.clear(); h.asyncStore.clear(); h.secure.clear(); h.nativeSignals = []; h.nativeCalls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0);
  vi.stubGlobal("fetch", h.fetch); h.fetch.mockRejectedValue(new TypeError("Network request failed")); // offline
  db = new DatabaseSync(":memory:"); h.open.mockResolvedValue(adapter());
  h.beforeInsert = null;
  h.drain.mockImplementation(async (limit: number) => h.nativeSignals.slice(0, limit));
  h.motionStatus = "authorized"; h.motionRecords = [];
  h.queryActivities.mockReset();
  h.queryActivities.mockImplementation(async (fromMs: number, toMs: number) => {
    const sorted = [...h.motionRecords].sort((a, b) => a.startMs - b.startMs);
    return sorted.filter((record, index) => record.startMs <= toMs && (sorted[index + 1]?.startMs ?? Infinity) > fromMs)
      .map((record) => ({ startMs: record.startMs, stationary: record.activity === "stationary", walking: record.activity === "walking",
        running: false, cycling: false, automotive: record.activity === "automotive", unknown: false, confidence: record.confidence }));
  });
  h.clearAll.mockImplementation(async () => { h.nativeCalls.push("clearAllSignals"); const n = h.nativeSignals.length; h.nativeSignals = []; return n; });
  h.stopExpo.mockImplementation(async () => { h.nativeCalls.push("expo:stopLocationUpdates"); });
  geofence = await import("../geofence"); // real task bodies and headless lifecycle listeners
  account = await import("../mobileAccount");
  store = await import("./store");
  runtime = await import("./runtime");
});

afterEach(async () => { await settle(); await new Promise(r => setTimeout(r, 0)); db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const place = { id: A_PLACE, name: "Synthetic A place", latitude: 51.5, longitude: -0.1, radiusMeters: 100 };
async function signIn(owner = A, places: typeof place[] = [], enabled = true) {
  await account.activateMobileAccount(owner);
  await runtime.bindLocationCaptureOwner(owner);
  await runtime.configureLocationIntelligence(bootstrap(owner, places));
  if (enabled) await geofence.setLocationLearningEnabled(true, places);
}
async function settle() { await runtime.withLocationCaptureLifecycle(async () => undefined); }
async function signOut(reason: "logout" | "signed_out" = "signed_out") {
  if (reason === "logout") await runtime.endLocationCaptureOwnership(reason, await account.readActiveMobileAccount() ?? undefined);
  else (await import("../mobileSessionTransition")).publishMobileSignedOut();
  await settle();
  if (reason === "logout") await account.deactivateMobileAccount();
  await settle();
}
const pendingIds = async (owner: typeof A) => {
  const batch = await store.prepareLocationUploadBatch(owner);
  return batch ? JSON.parse(batch.body_json).evidence.map((e: {clientEvidenceId: string}) => e.clientEvidenceId) : [];
};
function visit(id: string, arrival: number, departure: number) {
  return { id, kind: "visit", occurredAt: new Date(arrival).toISOString(), endedAt: new Date(departure).toISOString(),
    latitude: 51.5, longitude: -0.1, horizontalAccuracyMeters: 40, metadata: { visitDepartureOpen: "false" } };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe("Location capture ownership — real SQLite and lifecycle", () => {
  it("S1 explicit logout stops all sources and never adopts signed-out Expo/native observations", async () => {
    await signIn();
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    await signOut("logout");
    expect(rows()).toEqual([]);
    expect(h.nativeCalls).toEqual(expect.arrayContaining(["expo:stopLocationUpdates", "expo:stopGeofencing", "stopMonitoring", "clearAllSignals"]));
    await learningTask()({ data: { locations: [fix(T0 + 60_000)] }, error: null });
    h.nativeSignals.push(visit("signed-out-visit", T0 + 60_000, T0 + 120_000));
    await runtime.drainNativeLocationSignalsInBatches();
    expect(h.nativeSignals).toEqual([]);
    vi.setSystemTime(T0 + 180_000);
    await signIn(B);
    expect(rows()).toEqual([]);
    expect(await pendingIds(B)).toEqual([]);
  });

  it("S2 headless authoritative sign-out retains only accepted A evidence and B cannot read/upload it", async () => {
    await signIn();
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const accepted = rows()[0].id;
    await signOut();
    expect(await account.readActiveMobileAccount()).toBeNull();
    await learningTask()({ data: { locations: [fix(T0 + 60_000)] }, error: null });
    vi.setSystemTime(T0 + 180_000);
    await account.activateMobileAccount(B); // no Dashboard/bootstrap
    await settle();
    await learningTask()({ data: { locations: [fix(T0 + 120_000)] }, error: null });
    expect(rows()).toEqual([expect.objectContaining({ id: accepted, k: key(A) })]);
    expect(await pendingIds(A)).toEqual([]);
    expect(await pendingIds(B)).toEqual([]);
    expect((await store.getLocationStoreDiagnostics()).pendingEvidenceCount).toBe(0);
    await signOut();
    vi.setSystemTime(T0 + 240_000);
    await signIn(A);
    expect(await pendingIds(A)).toEqual([accepted]); // admission cutoff is not retroactive
  });

  it("S3 rejects pre-binding, completed and straddling Visits and admits only eligible members of mixed batches", async () => {
    await signIn();
    vi.setSystemTime(T0 + 180_000);
    await signIn(B);
    await learningTask()({ data: { locations: [fix(T0 - 600_000), fix(T0 - 300_000), fix(T0 + 181_000)] }, error: null });
    h.nativeSignals.push(visit("a-visit", T0 - 900_000, T0 - 60_000), visit("straddle", T0 + 120_000, T0 + 240_000));
    await runtime.drainNativeLocationSignalsInBatches();
    expect(rows()).toEqual([expect.objectContaining({ k: key(B), t: new Date(T0 + 181_000).toISOString() })]);
    expect(h.nativeSignals).toEqual([]);
    expect((await store.getLocationStoreDiagnostics()).captureRejectedEvidenceCounts.before_binding).toBe(4);
  });

  it("S4 rejects A's stale geofence registration and foreign catalogue IDs after B binds", async () => {
    await signIn(A, [place]);
    const aBinding = (await store.readLocationCaptureBinding())!;
    await signIn(B);
    await geofenceTask()({ data: { eventType: 1, region: { identifier: `${aBinding.id}:${A_PLACE}`, latitude: 51.5, longitude: -0.1, radius: 100 } }, error: null });
    expect(rows()).toEqual([]);
    expect((await store.getLocationStoreDiagnostics()).captureRejectedEvidenceCounts.foreign_place).toBe(1);
    expect(h.nativeCalls).toContain("expo:stopGeofencing");
  });

  it("S5 offline/locked-Keychain capture and cold headless restart preserve the same binding", async () => {
    await signIn();
    const before = await store.readLocationCaptureBinding();
    const secure = await import("expo-secure-store");
    vi.mocked(secure.getItemAsync).mockRejectedValueOnce(new Error("Keychain unavailable"));
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    expect(rows()).toHaveLength(1);
    vi.mocked(secure.getItemAsync).mockReset().mockImplementation(async k => h.secure.get(k) ?? null);
    vi.resetModules(); h.tasks.clear();
    geofence = await import("../geofence");
    account = await import("../mobileAccount");
    store = await import("./store"); runtime = await import("./runtime");
    await learningTask()({ data: { locations: [fix(T0 + 30_000, -0.11)] }, error: null });
    expect(rows().map(r => r.k)).toEqual([key(A), key(A)]);
    expect(await store.readLocationCaptureBinding()).toEqual(before);
    expect(db.prepare("select count(*) n from location_evidence_journal where upload_state in ('pending','batched')").get()!.n).toBe(2);
  });

  it("S6 B inherits neither consent nor place caches; A restores only A's consent", async () => {
    await signIn(A, [place]);
    expect((await geofence.getLocationVisitDiagnostics()).monitoredPlaceNames).toEqual([place.name]);
    await signOut("logout");
    expect((await geofence.getLocationVisitDiagnostics()).monitoredPlaceNames ?? []).toEqual([]);
    await signIn(B, [], false);
    h.nativeCalls.length = 0;
    await geofence.refreshGeofencesForPlaces([]);
    expect(await geofence.getLocationLearningEnabled()).toBe(false);
    expect(h.nativeCalls).not.toContain("expo:startLocationUpdates");
    expect((await geofence.getLocationVisitDiagnostics()).monitoredPlaceNames ?? []).toEqual([]);
    await signOut(); await signIn(A, [], false);
    expect(await geofence.getLocationLearningEnabled()).toBe(true);
  });

  it("A -> B -> A rejects an A-lifetime snapshot even though owner IDs match again", async () => {
    await signIn();
    const capture = await store.captureLocationOwnership();
    const evidence = store.evidenceFromExpoLocation(fix(T0 + 1_000), capture.context!);
    await account.activateMobileAccount(B);
    await account.activateMobileAccount(A);
    await settle();
    const binding = await store.readLocationCaptureBinding();
    h.nativeCalls.length = 0;
    expect(await runtime.bindLocationCaptureOwner(A, capture.revision)).toBe(false);
    expect(await store.readLocationCaptureBinding()).toEqual(binding);
    expect(h.nativeCalls).toEqual([]);
    expect((await store.readLocationCaptureBinding())!.id).not.toBe(capture.binding!.id);
    expect(await store.persistLocationEvidence([evidence], capture)).toMatchObject({ insertedCount: 0, rejectedCount: 1 });
    expect(rows()).toEqual([]);
  });

  it("rolls back callback inserts if the account changes inside the SQLite transaction", async () => {
    await signIn();
    const blocked = deferred(), entered = deferred();
    h.beforeInsert = async () => { entered.resolve(); await blocked.promise; };
    const callback = learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    await entered.promise;
    await account.activateMobileAccount(B);
    blocked.resolve(); await callback; h.beforeInsert = null;
    await settle();
    expect(rows()).toEqual([]);
    expect((await store.getLocationStoreDiagnostics()).captureRejectedEvidenceCounts.stale_epoch).toBe(1);
  });

  it("fences a native drain and its clear while replacement monitoring waits", async () => {
    await signIn();
    const blocked = deferred(), entered = deferred();
    h.drain.mockImplementationOnce(async () => { entered.resolve(); await blocked.promise; return [visit("late-a", T0, T0 + 30_000)]; });
    const drain = runtime.drainNativeLocationSignalsInBatches();
    await entered.promise;
    await account.activateMobileAccount(B);
    const bindB = runtime.bindLocationCaptureOwner(B);
    blocked.resolve(); await drain; await bindB;
    expect(rows()).toEqual([]);
    expect(h.nativeCalls).toContain("clearSignals:1");
    expect((await store.readLocationCaptureBinding())!.accountKey).toBe(key(B));
  });

  it("serialises awaited A teardown before B start, and stale explicit A cleanup cannot affect B", async () => {
    await signIn();
    const blocked = deferred(), entered = deferred();
    h.stopExpo.mockImplementationOnce(async () => { entered.resolve(); await blocked.promise; });
    const endA = runtime.endLocationCaptureOwnership("signed_out", A);
    await entered.promise;
    await account.activateMobileAccount(B);
    const b = runtime.bindLocationCaptureOwner(B);
    blocked.resolve(); await endA; await b;
    await runtime.configureLocationIntelligence(bootstrap(B));
    await geofence.setLocationLearningEnabled(true);
    const binding = await store.readLocationCaptureBinding();
    await runtime.endLocationCaptureOwnership("logout", A);
    expect(await store.readLocationCaptureBinding()).toEqual(binding);
    expect(await geofence.getLocationLearningEnabled()).toBe(true);
  });

  it("same-owner activation, bootstrap and refresh keep the admission cutoff", async () => {
    await signIn(A, [place]);
    const before = await store.readLocationCaptureBinding();
    vi.setSystemTime(T0 + 180_000);
    await account.activateMobileAccount(A); await runtime.bindLocationCaptureOwner(A);
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    await learningTask()({ data: { locations: [fix(T0 + 60_000)] }, error: null });
    expect(await store.readLocationCaptureBinding()).toEqual(before);
    expect(rows()).toHaveLength(1);
  });

  it("opt-out invalidates callbacks and region registrations; re-enable starts a new lifetime", async () => {
    await signIn(A, [place]);
    const capture = await store.captureLocationOwnership();
    await geofence.setLocationLearningEnabled(false);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    vi.setSystemTime(T0 + 180_000);
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    await geofence.setLocationLearningEnabled(true, [place]);
    await geofenceTask()({ data: { eventType: 1, region: { identifier: `${capture.binding!.id}:${A_PLACE}`, latitude: 51.5, longitude: -0.1, radius: 100 } }, error: null });
    expect(rows()).toEqual([]);
    expect((await store.getLocationStoreDiagnostics()).captureRejectedEvidenceCounts.stale_epoch).toBe(1);
  });

  it("ends admission despite OS stop failures and records only a safe count", async () => {
    await signIn();
    h.stopExpo.mockRejectedValueOnce(new Error("synthetic stop failure"));
    await runtime.endLocationCaptureOwnership("signed_out", A);
    expect(await store.readLocationCaptureBinding()).toBeNull();
    expect((await store.getLocationStoreDiagnostics()).captureCleanupFailureCount).toBe(1);
  });

  it("validates sample timestamps without replacing them with callback time", async () => {
    await signIn();
    await learningTask()({ data: { locations: [fix(NaN), fix(T0 - 1_000), fix(T0 + 1_000)] }, error: null });
    expect(rows().map(r => r.t)).toEqual([new Date(T0 + 1_000).toISOString()]);
    expect((await store.getLocationStoreDiagnostics()).captureRejectedEvidenceCounts).toMatchObject({ invalid_timestamp: 1, before_binding: 1 });
  });

  it("migrates legacy consent only with a demonstrable matching owner and drops ambiguity", async () => {
    await signIn(A, [], false);
    h.asyncStore.set("dayframe.location.learning.enabled.v1", "true");
    await geofence.migrateLegacyLocationOptIn(A);
    expect(await geofence.getLocationLearningEnabled()).toBe(true);
    expect(h.asyncStore.has("dayframe.location.learning.enabled.v1")).toBe(false);
    await signOut();
    h.asyncStore.set("dayframe.location.learning.enabled.v1", "true");
    await account.activateMobileAccount(B); await settle();
    expect(await geofence.getLocationLearningEnabled()).toBe(false);
    expect(h.asyncStore.has("dayframe.location.learning.enabled.v1")).toBe(false);
  });

  it("purges legacy unbound rows on upgrade/restart idempotently without relabelling", async () => {
    await signIn();
    const capture = await store.captureLocationOwnership();
    const evidence = store.evidenceFromExpoLocation(fix(T0 + 1_000), capture.context!);
    db.prepare("insert into location_evidence_journal values(?,?,?,?,?,'pending',null,?)").run("legacy", "unbound", evidence.occurredAt, "2099-01-01T00:00:00Z", JSON.stringify(evidence), evidence.occurredAt);
    vi.resetModules(); store = await import("./store");
    expect((await store.getLocationStoreDiagnostics()).legacyUnboundDeletedCount).toBe(1);
    expect(rows()).toEqual([]);
    vi.resetModules(); store = await import("./store");
    expect((await store.getLocationStoreDiagnostics()).legacyUnboundDeletedCount).toBe(1);
  });
  it("a delayed signed-out self-heal cannot invalidate a newer B activation", async () => {
    await signIn(); await signOut();
    const signedOut = await store.captureLocationOwnership();
    await account.activateMobileAccount(B);
    const revision = store.locationCaptureRevision();
    await runtime.stopUnownedLocationCapture(signedOut); await settle();
    expect(store.locationCaptureRevision()).toBe(revision);
    expect((await store.readLocationCaptureBinding())!.accountKey).toBe(key(B));
  });

  it("opt-out/re-enable restores the owner's catalogue without waiting for bootstrap", async () => {
    await signIn(A, [place]);
    const before = await store.readLocationCaptureBinding();
    await geofence.setLocationLearningEnabled(false, [place], A);
    vi.setSystemTime(T0 + 180_000);
    await geofence.setLocationLearningEnabled(true, [place], A);
    const after = (await store.readLocationCaptureBinding())!;
    expect(after.id).not.toBe(before!.id);
    await geofenceTask()({ data: { eventType: 1, region: { identifier: `${after.id}:${A_PLACE}`, latitude: 51.5, longitude: -0.1, radius: 100 } }, error: null });
    expect(rows()).toEqual([expect.objectContaining({k:key(A),p:A_PLACE})]);
  });

  it("stale A catalogue refresh or consent requests cannot clear or overwrite B places", async () => {
    await signIn(A, [place]);
    const bPlace = {...place,id:"b0000000-0000-4000-8000-00000000b1ce",name:"Synthetic B place"};
    await signIn(B, [bPlace]);
    const before = await store.readLocationCaptureBinding();
    h.nativeCalls.length = 0;
    await geofence.refreshGeofencesForPlaces([place], A);
    await geofence.setLocationLearningEnabled(false, [place], A);
    expect(await store.readLocationCaptureBinding()).toEqual(before);
    expect(await geofence.getLocationLearningEnabled()).toBe(true);
    expect((await geofence.getLocationVisitDiagnostics()).monitoredPlaceNames).toEqual([bPlace.name]);
    expect(h.nativeCalls).not.toContain("expo:stopGeofencing");
  });

  it("legacy owner upgrade retains owned rows, creates a current cutoff, and never reassigns unbound rows", async () => {
    await signIn();
    await learningTask()({data:{locations:[fix(T0+1_000)]},error:null});
    const accepted=rows()[0].id;
    db.prepare("delete from location_store_metadata where key='capture_binding_v1'").run();
    for (const k of [...h.asyncStore.keys()]) if (k.startsWith("dayframe.location.learning.enabled.v1:account:")) h.asyncStore.delete(k);
    h.asyncStore.set("dayframe.location.learning.enabled.v1","true");
    vi.setSystemTime(T0+180_000);
    vi.resetModules(); h.tasks.clear();
    geofence=await import("../geofence"); account=await import("../mobileAccount");
    store=await import("./store"); runtime=await import("./runtime");
    await runtime.bindLocationCaptureOwner((await account.readActiveMobileAccount())!);
    expect(await geofence.getLocationLearningEnabled()).toBe(true);
    expect((await store.readLocationCaptureBinding())!.boundAt).toBe(new Date(T0+180_000).toISOString());
    await learningTask()({data:{locations:[fix(T0+120_000),fix(T0+181_000)]},error:null});
    expect(rows().map(r=>r.id)).toContain(accepted);
    expect(rows()).toHaveLength(2);
    expect(await pendingIds(A)).toContain(accepted);
  });

  it("a delayed A diagnostics read cannot commit its error or places into B's cache", async () => {
    await signIn(A, [place]);
    const asyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    const read = vi.mocked(asyncStorage.getItem);
    const previousRead = read.getMockImplementation()!;
    const entered = deferred(), blocked = deferred();
    let pause = true;
    read.mockImplementation(async storageKey => {
      if (pause && storageKey.startsWith("dayframe.location.diagnostics.v1:account:")) {
        pause = false;
        entered.resolve();
        await blocked.promise;
      }
      return h.asyncStore.get(storageKey) ?? null;
    });
    const callback = learningTask()({ data: { locations: [] }, error: new Error("synthetic A error") });
    await entered.promise;
    const bPlace = { ...place, id: "b0000000-0000-4000-8000-00000000b1ce", name: "Synthetic B place" };
    await signIn(B, [bPlace]);
    const before = await geofence.getLocationVisitDiagnostics();
    blocked.resolve();
    await callback;
    expect(await geofence.getLocationVisitDiagnostics()).toEqual(before);
    expect(before.monitoredPlaceNames).toEqual([bPlace.name]);
    read.mockImplementation(previousRead);
  });

  it("pins deprecated V1 event callbacks and caches while a place-enter awaits", async () => {
    await signIn(A,[place]);
    await runtime.configureLocationIntelligence({...bootstrap(A,[place]),locationRolloutMode:"v1"} as never);
    const binding=(await store.readLocationCaptureBinding())!;
    const expo=await import("expo-location"); const blocked=deferred(), entered=deferred();
    vi.mocked(expo.getLastKnownPositionAsync).mockImplementationOnce(async()=>{entered.resolve();await blocked.promise;return null;});
    const callback=geofenceTask()({data:{eventType:1,region:{identifier:`${binding.id}:${A_PLACE}`,latitude:51.5,longitude:-0.1,radius:100}},error:null});
    await entered.promise;await account.activateMobileAccount(B);
    blocked.resolve();await callback;await settle();
    expect(rows()).toEqual([]);
    expect((await geofence.getLocationVisitDiagnostics()).monitoredPlaceNames??[]).toEqual([]);
    expect((await import("../api")).enqueueEvent).not.toHaveBeenCalled();
  });

  it("discards malformed native source times before clearing their IDs, without synthesising Visits", async () => {
    await signIn();
    h.nativeSignals.push({...visit("invalid-visit",T0,T0+10_000),occurredAt:"invalid"},visit("valid-visit",T0+1_000,T0+10_000));
    await runtime.drainNativeLocationSignalsInBatches();
    expect(rows()).toEqual([expect.objectContaining({id:"valid-visit",k:key(A)})]);
    expect(h.nativeSignals).toEqual([]);
    expect((await store.getLocationStoreDiagnostics()).captureRejectedEvidenceCounts.invalid_evidence).toBe(1);
  });

  it("retains A's accepted work on invalidation and applies existing raw journal retention", async () => {
    await signIn();await learningTask()({data:{locations:[fix(T0+1_000)]},error:null});
    await store.prepareLocationUploadBatch(A);await signOut();
    expect(rows()).toHaveLength(1);
    vi.setSystemTime(T0+8*86_400_000);
    await store.applyLocationRetention();
    expect(rows()).toEqual([]);
  });

  it("suspends admission immediately while teardown waits behind an old native drain", async () => {
    await signIn();
    const entered=deferred(),blocked=deferred();
    h.drain.mockImplementationOnce(async()=>{entered.resolve();await blocked.promise;return [];});
    const drain=runtime.drainNativeLocationSignalsInBatches();await entered.promise;
    const end=runtime.endLocationCaptureOwnership("opt_out",A);
    const callback=learningTask()({data:{locations:[fix(T0+1_000)]},error:null});
    blocked.resolve();await drain;await end;await callback;
    expect(rows()).toEqual([]);
    expect(await geofence.getLocationLearningEnabled()).toBe(false);
  });

  it("hydrates a matching legacy owner and consent on first headless callback without Keychain", async () => {
    await signIn(A,[place]);
    await learningTask()({data:{locations:[fix(T0+1_000)]},error:null});
    const accepted=rows()[0].id;
    db.prepare("delete from location_store_metadata where key='capture_binding_v1'").run();
    for(const k of [...h.asyncStore.keys()]) if(k.startsWith("dayframe.location.learning.enabled.v1:account:")) h.asyncStore.delete(k);
    h.asyncStore.set("dayframe.location.learning.enabled.v1","true");
    vi.setSystemTime(T0+180_000);vi.resetModules();h.tasks.clear();
    geofence=await import("../geofence");account=await import("../mobileAccount");store=await import("./store");runtime=await import("./runtime");
    const secure=await import("expo-secure-store");vi.mocked(secure.getItemAsync).mockClear().mockRejectedValue(new Error("Keychain unavailable"));
    h.nativeCalls.length=0;
    await learningTask()({data:{locations:[fix(T0+120_000),fix(T0+181_000)]},error:null});
    expect(secure.getItemAsync).not.toHaveBeenCalled();
    expect(await geofence.getLocationLearningEnabled()).toBe(true);
    expect((await store.readLocationCaptureBinding())!.boundAt).toBe(new Date(T0+180_000).toISOString());
    expect(rows()).toHaveLength(2);expect(rows().map(r=>r.id)).toContain(accepted);
    expect(h.nativeCalls).toContain("expo:startLocationUpdates");expect(h.nativeCalls).toContain("startMonitoring");
    vi.mocked(secure.getItemAsync).mockReset().mockImplementation(async k=>h.secure.get(k)??null);
  });

});

describe("PR 213 consent and semantic cutover regressions", () => {
  it("configure-then-refresh cannot restart capture when Settings opts out during the actual native drain (P1b)", async () => {
    await signIn(A, [place]);
    const entered = deferred(), blocked = deferred();
    h.drain.mockImplementationOnce(async () => { entered.resolve(); await blocked.promise; return []; });
    const dashboard = (async () => {
      await runtime.configureLocationIntelligence(bootstrap(A, [place]));
      return geofence.refreshGeofencesForPlaces([place], A);
    })();
    await entered.promise;
    const revision = store.locationCaptureRevision();
    const optOut = geofence.setLocationLearningEnabled(false, [place], A);
    for (let i = 0; i < 200 && store.locationCaptureRevision() === revision; i++) await Promise.resolve();
    expect(store.locationCaptureRevision()).toBeGreaterThan(revision);
    h.nativeCalls.length = 0;
    blocked.resolve();
    await dashboard; await optOut; await settle();
    const binding = (await store.readLocationCaptureBinding())!;
    expect(binding.enabled).toBe(false);
    expect(await geofence.getLocationLearningEnabled()).toBe(false);
    expect(h.nativeCalls.filter(c => c.startsWith("expo:start") || c === "startMonitoring")).toEqual([]);
    await geofenceTask()({ data: { eventType: 1, region: { identifier: `${binding.id}:${A_PLACE}` } }, error: null });
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    h.nativeSignals.push(visit("opted-out", T0 + 1_000, T0 + 30_000));
    await runtime.drainNativeLocationSignalsInBatches();
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    expect((await store.readLocationCaptureBinding())!.enabled).toBe(false);
    expect(rows()).toEqual([]);
    vi.setSystemTime(T0 + 60_000);
    await geofence.setLocationLearningEnabled(true, [place], A);
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    expect(rows()).toHaveLength(1);
  });

  it("an already queued enabled catalogue snapshot cannot recreate a disabled binding (P1)", async () => {
    await signIn(A, [place]);
    const blocked = deferred(), entered = deferred();
    const lane = runtime.withLocationCaptureLifecycle(async () => { entered.resolve(); await blocked.promise; });
    await entered.promise;
    const optOut = geofence.setLocationLearningEnabled(false, [place], A);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    const refresh = geofence.refreshGeofencesForPlaces([place], A);
    h.nativeCalls.length = 0;
    blocked.resolve(); await lane; await optOut; await refresh;
    expect((await store.readLocationCaptureBinding())!.enabled).toBe(false);
    expect(h.nativeCalls.filter(c => c.startsWith("expo:start") || c === "startMonitoring")).toEqual([]);
  });

  it("local scoped consent is required at task/start and SQLite commit boundaries even with an enabled snapshot", async () => {
    await signIn(A, [place]);
    const capture = await store.captureLocationOwnership();
    const evidence = store.evidenceFromExpoLocation(fix(T0 + 1_000), capture.context!);
    await geofence.writeLocationLearningPreference(A, false);
    h.nativeCalls.length = 0;
    await geofenceTask()({ data: { eventType: 1, region: { identifier: `${capture.binding!.id}:${A_PLACE}` } }, error: null });
    await geofence.startGeofences([place], A);
    await geofence.startLocationLearning([place]);
    await runtime.withLocationCaptureLifecycle(() => runtime.startNativeLocationIntelligence());
    expect(await store.persistLocationEvidence([evidence], capture)).toMatchObject({ insertedCount: 0, rejectedCount: 1 });
    expect(rows()).toEqual([]);
    expect(h.nativeCalls.filter(c => c.startsWith("expo:start") || c === "startMonitoring")).toEqual([]);
    await geofence.writeLocationLearningPreference(A, true);
    h.beforeInsert = () => geofence.writeLocationLearningPreference(A, false);
    expect(await store.persistLocationEvidence([evidence], capture)).toMatchObject({ insertedCount: 0, rejectedCount: 1 });
    h.beforeInsert = null;
    expect(rows()).toEqual([]); // consent loss inside the real transaction rolls it back
  });

  it("opt-out leaves accepted work observable/uploadable without a bootstrap (P20)", async () => {
    await signIn();
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const accepted = rows()[0].id;
    await geofence.setLocationLearningEnabled(false);
    expect((await store.getLocationStoreDiagnostics()).pendingEvidenceCount).toBe(1);
    expect(await pendingIds(A)).toEqual([accepted]);
    expect((await store.readLocationCaptureBinding())!.enabled).toBe(false);
  });

  it("activation before cold account hydration preserves the persisted same-owner binding and native journal (N1)", async () => {
    await signIn(A, [place]);
    const before = await store.readLocationCaptureBinding();
    h.nativeSignals.push(visit("retained-native", T0 + 1_000, T0 + 30_000));
    vi.setSystemTime(T0 + 60_000); vi.resetModules(); h.tasks.clear();
    geofence = await import("../geofence"); account = await import("../mobileAccount");
    store = await import("./store"); runtime = await import("./runtime");
    h.nativeCalls.length = 0;
    await account.activateMobileAccount(A); // deliberately before readActiveMobileAccount
    await settle();
    expect(await store.readLocationCaptureBinding()).toEqual(before);
    expect(h.nativeSignals).toHaveLength(1);
    expect(h.nativeCalls).not.toContain("clearAllSignals");
    await runtime.drainNativeLocationSignalsInBatches();
    expect(rows()).toHaveLength(1);
  });

  it("a cancelled old A logout cannot leave the newer same-owner capture suspended (P6)", async () => {
    await signIn();
    const before = await store.captureLocationOwnership();
    const blocked = deferred(), entered = deferred();
    const lane = runtime.withLocationCaptureLifecycle(async () => { entered.resolve(); await blocked.promise; });
    await entered.promise;
    let current = true;
    const end = runtime.endLocationCaptureOwnership("logout", A, () => current);
    current = false;
    blocked.resolve(); await lane; await end;
    vi.setSystemTime(T0 + 60_000);
    await account.activateMobileAccount(A);
    expect(await runtime.bindLocationCaptureOwner(A)).toBe(true);
    const after = await store.captureLocationOwnership();
    expect(after.binding!.id).not.toBe(before.binding!.id);
    expect(store.isLocationCaptureSnapshotCurrent(after)).toBe(true);
    expect(await store.persistLocationEvidence([store.evidenceFromExpoLocation(fix(T0 + 1_000), before.context!)], before)).toMatchObject({ insertedCount: 0 });
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    expect(rows()).toHaveLength(1);
  });

  async function semanticBacklog() {
    const otherPlace = { ...place, id: "a0000000-0000-4000-8000-00000000a2ce", name: "Synthetic second place", longitude: -0.12 };
    await signIn(A, [place, otherPlace]);
    vi.setSystemTime(T0 + 600_000);
    h.nativeSignals.push(visit("shadow-visit", T0 + 1_000, T0 + 540_000));
    await runtime.drainNativeLocationSignalsInBatches();
    vi.setSystemTime(T0 + 1_200_000);
    await runtime.configureLocationIntelligence({ ...bootstrap(A, [place, otherPlace]), locationRolloutMode: "v2_review" });
    const ack = new Date(T0 + 1_200_000).toISOString();
    vi.setSystemTime(T0 + 1_800_000);
    h.nativeSignals.push({ ...visit("review-visit", T0 + 1_260_000, T0 + 1_740_000), longitude: otherPlace.longitude });
    await runtime.drainNativeLocationSignalsInBatches();
    await store.processPendingLocationEvidence(new Date(T0 + 2_350_000).toISOString());
    const segments = await store.readLocationSegments();
    const shadow = segments.find(s => s.evidenceIds.includes("shadow-visit"))!;
    const eligible = segments.find(s => s.evidenceIds.includes("review-visit"))!;
    expect(shadow).toBeDefined(); expect(eligible).toBeDefined();
    expect(eligible.status).toBe("finalised");
    expect(eligible.startedAt).toBe(new Date(T0 + 1_260_000).toISOString());
    return { ack, shadow, eligible };
  }
  it.each(["invalidation", "opt-out", "legacy upgrade"] as const)("generated upload values preserve semantic eligibility across %s, without reopening capture (P4/P4b/P23)", async transition => {
    const { ack, shadow, eligible } = await semanticBacklog();
    const before = await store.captureLocationOwnership();
    vi.setSystemTime(T0 + 2_400_000);
    if (transition === "invalidation") {
      await signOut();
      await account.activateMobileAccount(A);
      await runtime.bindLocationCaptureOwner(A);
    } else if (transition === "opt-out") {
      await geofence.setLocationLearningEnabled(false, [place], A);
      await geofence.setLocationLearningEnabled(true, [place], A);
    } else {
      db.exec("delete from location_store_metadata where key='capture_binding_v1' or key like 'semantic_eligibility:%'");
      vi.resetModules(); h.tasks.clear();
      geofence = await import("../geofence"); account = await import("../mobileAccount");
      store = await import("./store"); runtime = await import("./runtime");
      await runtime.bindLocationCaptureOwner((await account.readActiveMobileAccount())!);
    }
    await runtime.configureLocationIntelligence({ ...bootstrap(A, [place]), locationRolloutMode: "v2_review" });
    const after = await store.captureLocationOwnership();
    expect(after.binding!.id).not.toBe(before.binding!.id);
    expect(Date.parse(after.binding!.boundAt)).toBe(T0 + 2_400_000);
    await learningTask()({ data: { locations: [fix(T0 + 2_000_000)] }, error: null });
    expect(rows().some(r => r.t === new Date(T0 + 2_000_000).toISOString())).toBe(false);
    const batch = await store.prepareLocationUploadBatch(A);
    const body = JSON.parse(batch!.body_json);
    expect(body.semanticModeAcknowledgedAt).toBe(ack);
    expect(body.evidence.map((e: { clientEvidenceId: string }) => e.clientEvidenceId)).toContain("review-visit");
    const decision = decideLocationRollout("v2_review", body.rolloutMode, body.semanticModeAcknowledgedAt);
    expect(decision.emitV2ReviewItems).toBe(true);
    expect(segmentStartedAfterSemanticCutover(eligible.startedAt, decision.semanticCutoverAt!)).toBe(true);
    expect(segmentStartedAfterSemanticCutover(shadow.startedAt, decision.semanticCutoverAt!)).toBe(false);
    expect(decideLocationRollout("v2_shadow", body.rolloutMode, body.semanticModeAcknowledgedAt).emitV2ReviewItems).toBe(false);
  });

  async function generatedBody(owner: typeof A, occurredAt: number) {
    await learningTask()({ data: { locations: [fix(occurredAt)] }, error: null });
    const batch = await store.prepareLocationUploadBatch(owner);
    return JSON.parse(batch!.body_json);
  }

  it("semantic acknowledgements isolate A/B and explicit logout resets A's cutover", async () => {
    const { ack, eligible } = await semanticBacklog();
    vi.setSystemTime(T0 + 2_400_000);
    await account.activateMobileAccount(B); await runtime.bindLocationCaptureOwner(B);
    await runtime.configureLocationIntelligence({ ...bootstrap(B), locationRolloutMode: "v2_review" });
    await geofence.setLocationLearningEnabled(true);
    const b = await generatedBody(B, T0 + 2_401_000);
    expect(b.semanticModeAcknowledgedAt).toBe(new Date(T0 + 2_400_000).toISOString());
    expect(b.semanticModeAcknowledgedAt).not.toBe(ack);
    await signOut("logout");
    vi.setSystemTime(T0 + 3_000_000);
    await account.activateMobileAccount(A); await runtime.bindLocationCaptureOwner(A);
    await runtime.configureLocationIntelligence({ ...bootstrap(A, [place]), locationRolloutMode: "v2_review" });
    expect((await generatedBody(A, T0 + 3_001_000)).semanticModeAcknowledgedAt).toBe(ack);
    await signOut("logout");
    vi.setSystemTime(T0 + 3_600_000);
    await account.activateMobileAccount(A); await runtime.bindLocationCaptureOwner(A);
    await runtime.configureLocationIntelligence({ ...bootstrap(A, [place]), locationRolloutMode: "v2_review" });
    const fresh = await generatedBody(A, T0 + 3_601_000);
    expect(fresh.semanticModeAcknowledgedAt).toBe(new Date(T0 + 3_600_000).toISOString());
    expect(fresh.evidence.map((e: { clientEvidenceId: string }) => e.clientEvidenceId)).not.toContain("review-visit");
    const decision = decideLocationRollout("v2_review", fresh.rolloutMode, fresh.semanticModeAcknowledgedAt);
    expect(segmentStartedAfterSemanticCutover(eligible.startedAt, decision.semanticCutoverAt!)).toBe(false);
  });

  it("real bootstrap mode transitions preserve semantic-to-semantic acknowledgement and reset after shadow", async () => {
    const { ack, eligible } = await semanticBacklog();
    vi.setSystemTime(T0 + 2_400_000);
    await runtime.configureLocationIntelligence({ ...bootstrap(A, [place]), locationRolloutMode: "v2_enabled" });
    const enabled = await generatedBody(A, T0 + 2_401_000);
    expect(enabled.rolloutMode).toBe("v2_enabled");
    expect(enabled.semanticModeAcknowledgedAt).toBe(ack);
    expect(decideLocationRollout("v2_review", enabled.rolloutMode, enabled.semanticModeAcknowledgedAt).emitV2ReviewItems).toBe(false);
    expect(decideLocationRollout("v2_enabled", enabled.rolloutMode, enabled.semanticModeAcknowledgedAt).emitV2ReviewItems).toBe(true);
    vi.setSystemTime(T0 + 3_000_000);
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    const shadowCapture = await store.captureLocationOwnership();
    await store.persistLocationEvidence([store.evidenceFromExpoLocation(fix(T0 + 3_001_000), shadowCapture.context!)], shadowCapture);
    const shadowBatch = await store.prepareLocationUploadBatch(A, { excludeBatchIds: [enabled.clientBatchId] });
    const shadow = JSON.parse(shadowBatch!.body_json);
    expect(shadow.rolloutMode).toBe("v2_shadow"); expect(shadow.semanticModeAcknowledgedAt).toBeUndefined();
    expect(decideLocationRollout("v2_review", shadow.rolloutMode, shadow.semanticModeAcknowledgedAt).emitV2ReviewItems).toBe(false);
    vi.setSystemTime(T0 + 3_600_000);
    await runtime.configureLocationIntelligence({ ...bootstrap(A, [place]), locationRolloutMode: "v2_review" });
    const capture = await store.captureLocationOwnership();
    await store.persistLocationEvidence([store.evidenceFromExpoLocation(fix(T0 + 3_601_000), capture.context!)], capture);
    const batch = await store.prepareLocationUploadBatch(A, { excludeBatchIds: [enabled.clientBatchId, shadow.clientBatchId] });
    const review = JSON.parse(batch!.body_json);
    expect(review.semanticModeAcknowledgedAt).toBe(new Date(T0 + 3_600_000).toISOString());
    const decision = decideLocationRollout("v2_review", review.rolloutMode, review.semanticModeAcknowledgedAt);
    expect(segmentStartedAfterSemanticCutover(eligible.startedAt, decision.semanticCutoverAt!)).toBe(false);
  });

  it.each(["foreign backend", "different legacy owner"])("does not restore an acknowledgement with %s attribution", async ambiguity => {
    const { ack } = await semanticBacklog();
    db.exec("delete from location_store_metadata where key like 'semantic_eligibility:%'");
    if (ambiguity === "foreign backend") {
      const binding = (await store.readLocationCaptureBinding())!;
      db.prepare("update location_store_metadata set value=? where key='capture_binding_v1'").run(JSON.stringify({ ...binding, backend: "https://foreign.invalid" }));
    } else {
      db.exec("delete from location_store_metadata where key='capture_binding_v1'");
      db.prepare("update location_store_metadata set value=? where key='active_account'").run(key(B));
    }
    vi.setSystemTime(T0 + 2_400_000); vi.resetModules(); h.tasks.clear();
    geofence = await import("../geofence"); account = await import("../mobileAccount");
    store = await import("./store"); runtime = await import("./runtime");
    await runtime.bindLocationCaptureOwner((await account.readActiveMobileAccount())!);
    const body = await generatedBody(A, T0 + 2_401_000);
    expect(body.rolloutMode).toBe("v2_shadow"); expect(body.semanticModeAcknowledgedAt).toBeUndefined();
    expect(decideLocationRollout("v2_review", body.rolloutMode, body.semanticModeAcknowledgedAt).emitV2ReviewItems).toBe(false);
    await runtime.configureLocationIntelligence({ ...bootstrap(A, [place]), locationRolloutMode: "v2_review" });
    const value = db.prepare("select value from location_store_metadata where key='semantic_mode_acknowledged_at'").get()!.value;
    expect(value).not.toBe(ack);
    expect(value).toBe(new Date(T0 + 2_400_000).toISOString());
  });
});

describe("native signal delivery on background wakes", () => {
  it("a location-learning wake drains pending native Visits into the same owned journal", async () => {
    await signIn();
    vi.setSystemTime(T0 + 60_000);
    h.nativeSignals.push(visit("wake-visit", T0 + 10_000, T0 + 50_000));
    await learningTask()({ data: { locations: [fix(T0 + 55_000)] }, error: null });
    expect(rows().map(r => [r.id, r.k])).toEqual(expect.arrayContaining([["wake-visit", key(A)]]));
    expect(rows()).toHaveLength(2);
    expect(h.nativeSignals).toEqual([]);
  });

  it("a geofence wake drains pending native Visits after persisting the transition", async () => {
    await signIn(A, [place]);
    const binding = (await store.readLocationCaptureBinding())!;
    vi.setSystemTime(T0 + 60_000);
    h.nativeSignals.push(visit("geofence-wake-visit", T0 + 10_000, T0 + 50_000));
    await geofenceTask()({ data: { eventType: 1, region: { identifier: `${binding.id}:${A_PLACE}`, latitude: 51.5, longitude: -0.1, radius: 100 } }, error: null });
    expect(rows().map(r => r.id)).toContain("geofence-wake-visit");
    expect(rows()).toHaveLength(2);
    expect(h.nativeSignals).toEqual([]);
  });

  it("a failed native drain keeps the Expo batch and leaves the native journal for the next drain", async () => {
    await signIn();
    vi.setSystemTime(T0 + 60_000);
    h.nativeSignals.push(visit("retry-visit", T0 + 10_000, T0 + 50_000));
    h.drain.mockRejectedValueOnce(new Error("synthetic native drain failure"));
    await learningTask()({ data: { locations: [fix(T0 + 55_000)] }, error: null });
    expect(rows().map(r => r.id)).not.toContain("retry-visit");
    expect(rows()).toHaveLength(1);
    expect(h.nativeSignals).toHaveLength(1);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(rows().map(r => r.id)).toContain("retry-visit");
  });

  it("a stale wake after sign-out never drains signed-out native signals into the journal", async () => {
    await signIn();
    await signOut("logout");
    h.drain.mockClear();
    h.nativeSignals.push(visit("signed-out-wake", T0 + 10_000, T0 + 50_000));
    await learningTask()({ data: { locations: [fix(T0 + 55_000)] }, error: null });
    expect(rows()).toEqual([]);
    expect(h.drain).not.toHaveBeenCalled();
  });
});

describe("Motion & Fitness capture", () => {
  const motionRows = () => db.prepare(
    "select client_evidence_id id, account_key k, occurred_at t, json_extract(evidence_json,'$.metadata.motionActivity') a, json_extract(evidence_json,'$.latitude') lat from location_evidence_journal where json_extract(evidence_json,'$.kind') = 'motion_activity' order by occurred_at, client_evidence_id"
  ).all() as Array<{ id: string; k: string; t: string; a: string; lat: number | null }>;
  const iso = (ms: number) => new Date(ms).toISOString();

  it("a wake records activity since the binding once, as coordinate-free evidence of the owner", async () => {
    h.motionRecords = [
      { startMs: T0 - 3_600_000, activity: "stationary", confidence: "high" },
      { startMs: T0 + 60_000, activity: "walking", confidence: "high" },
      { startMs: T0 + 120_000, activity: "automotive", confidence: "high" },
      { startMs: T0 + 600_000, activity: "stationary", confidence: "high" }
    ];
    await signIn();
    vi.setSystemTime(T0 + 900_000);
    await learningTask()({ data: { locations: [fix(T0 + 890_000)] }, error: null });
    // Activity in progress at the binding began before it and is never recorded.
    expect(motionRows().map((row) => [row.t, row.a, row.k, row.lat])).toEqual([
      [iso(T0 + 60_000), "walking", key(A), null],
      [iso(T0 + 120_000), "automotive", key(A), null],
      [iso(T0 + 600_000), "stationary", key(A), null],
      [iso(T0 + 900_000), "stationary", key(A), null]
    ]);
    vi.setSystemTime(T0 + 1_000_000);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(motionRows()).toHaveLength(4);
    // It re-reads fifteen minutes before the latest record seen (never before the binding).
    expect(h.queryActivities).toHaveBeenLastCalledWith(T0, T0 + 1_000_000, 2_000);
    expect(await pendingIds(A)).toEqual(expect.arrayContaining(motionRows().map((row) => row.id)));
  });

  it("Delete recent evidence never reads the deleted activity back from iOS", async () => {
    h.motionRecords = [
      { startMs: T0 + 60_000, activity: "walking", confidence: "high" },
      { startMs: T0 + 300_000, activity: "stationary", confidence: "high" }
    ];
    await signIn();
    vi.setSystemTime(T0 + 600_000);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(motionRows().length).toBeGreaterThan(0);
    await store.deleteRetainedLocationEvidence();
    expect(motionRows()).toEqual([]);
    vi.setSystemTime(T0 + 700_000);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(motionRows()).toEqual([]);
    h.motionRecords.push({ startMs: T0 + 800_000, activity: "walking", confidence: "high" });
    vi.setSystemTime(T0 + 850_000);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(motionRows().map((row) => row.t)).toEqual([iso(T0 + 800_000)]);
  });

  it("a query in flight across Delete recent evidence admits nothing and keeps the newer floor", async () => {
    h.motionRecords = [
      { startMs: T0 + 60_000, activity: "walking", confidence: "high" },
      { startMs: T0 + 300_000, activity: "stationary", confidence: "high" }
    ];
    await signIn();
    vi.setSystemTime(T0 + 600_000);
    const query = h.queryActivities.getMockImplementation()!;
    h.queryActivities.mockImplementationOnce(async (...args: [number, number]) => {
      const records = await query(...args);
      await store.deleteRetainedLocationEvidence(); // commits while the history read is in flight
      return records;
    });
    await runtime.drainNativeLocationSignalsInBatches();
    expect(motionRows()).toEqual([]);
    const stored = db.prepare("select value from location_store_metadata where key like 'motion_capture:%'").get() as { value: string };
    expect(JSON.parse(stored.value).floorMs).toBe(T0 + 600_000);
    vi.setSystemTime(T0 + 700_000);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(motionRows()).toEqual([]);
  });

  it("explicit logout removes the cursor and the next owner starts from its own binding", async () => {
    h.motionRecords = [{ startMs: T0 + 60_000, activity: "walking", confidence: "high" }];
    await signIn();
    vi.setSystemTime(T0 + 120_000);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(motionRows()).toHaveLength(1);
    await signOut("logout");
    expect(db.prepare("select key from location_store_metadata where key like 'motion_capture:%'").all()).toEqual([]);
    expect(motionRows()).toEqual([]);
    vi.setSystemTime(T0 + 300_000);
    h.motionRecords.push({ startMs: T0 + 400_000, activity: "automotive", confidence: "high" });
    await signIn(B);
    vi.setSystemTime(T0 + 450_000);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(motionRows().map((row) => [row.t, row.k])).toEqual([[iso(T0 + 400_000), key(B)]]);
  });

  it("queries nothing without Motion & Fitness permission and nothing for a signed-out wake", async () => {
    h.motionStatus = "denied";
    h.motionRecords = [{ startMs: T0 + 60_000, activity: "walking", confidence: "high" }];
    await signIn();
    vi.setSystemTime(T0 + 120_000);
    await runtime.drainNativeLocationSignalsInBatches();
    expect(h.queryActivities).not.toHaveBeenCalled();
    h.motionStatus = "authorized";
    await signOut("logout");
    await learningTask()({ data: { locations: [fix(T0 + 130_000)] }, error: null });
    expect(h.queryActivities).not.toHaveBeenCalled();
    expect(motionRows()).toEqual([]);
  });
});
