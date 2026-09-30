// Real API/session/account/Location regressions ported from Claude E1–E6.
// Synthetic data; OS and network doubles are not device or hosted evidence.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { LOCATION_ENGINE_V2_CONFIG, type LocationRolloutMode } from "@dayframe/shared";
import { decideLocationRollout, segmentStartedAfterSemanticCutover } from "../../../../apps/web/src/lib/location/location-rollout";

const h = vi.hoisted(() => ({
  dbs: new Map<string, DatabaseSync>(),
  open: vi.fn(),
  tasks: new Map<string, (body: { data: unknown; error: unknown }) => Promise<void>>(),
  asyncStore: new Map<string, string>(),
  secure: new Map<string, string>(),
  nativeSignals: [] as Array<Record<string, unknown>>,
  nativeCalls: [] as string[],
  appState: { currentState: "active" },
  beforeRun: null as ((sql: string) => Promise<void>) | null,
  cleanupFailure: false
}));
vi.mock("expo-sqlite", () => ({ openDatabaseAsync: h.open }));
vi.mock("./config", () => ({ DAYFRAME_API_BASE: "https://fixture.invalid" }));
vi.mock("./backendIdentity", () => ({ DAYFRAME_BACKEND_ID: "fixture-backend" }));
vi.mock("expo-crypto", () => ({}));
vi.mock("./healthSyncStore", () => ({ recordHealthAcknowledgement: vi.fn() }));
vi.mock("react-native", () => ({
  AppState: h.appState,
  NativeModules: { DayframeLiveActivityModule: {
    clearRuntimeContext: vi.fn(async () => true), clearRuntimeContextIfToken: vi.fn(async () => true), setRuntimeContext: vi.fn(async () => true) } },
  Platform: { OS: "ios" }, Settings: { get: () => undefined, set: () => undefined }
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: vi.fn(async (k: string) => h.secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => { h.secure.set(k, v); }),
  deleteItemAsync: vi.fn(async (k: string) => { h.secure.delete(k); })
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
  startGeofencingAsync: vi.fn(async () => { h.nativeCalls.push("expo:startGeofencing"); }),
  stopGeofencingAsync: vi.fn(async () => { h.nativeCalls.push("expo:stopGeofencing"); }),
  hasStartedLocationUpdatesAsync: vi.fn(async () => true),
  stopLocationUpdatesAsync: vi.fn(async () => { h.nativeCalls.push("expo:stopLocationUpdates"); })
}));
vi.mock("./locationGeocoding", () => ({ reverseGeocodeLocation: vi.fn(async () => null) }));
vi.mock("../../modules/dayframe-location-visits", () => ({
  drainSignals: vi.fn(async (limit: number) => h.nativeSignals.slice(0, limit)),
  clearSignals: vi.fn(async (ids: string[]) => { h.nativeSignals = h.nativeSignals.filter(s => !ids.includes(s.id as string)); return ids.length; }),
  clearAllSignals: vi.fn(async () => { if (h.cleanupFailure) throw new Error("Synthetic native cleanup failure"); h.nativeCalls.push("clearAllSignals"); const n = h.nativeSignals.length; h.nativeSignals = []; return n; }),
  startMonitoring: vi.fn(async () => { h.nativeCalls.push("startMonitoring"); return {}; }),
  stopMonitoring: vi.fn(async () => { h.nativeCalls.push("stopMonitoring"); return {}; }),
  getStatus: vi.fn(async () => ({}))
}));

const A = { userId: "a0000000-0000-4000-8000-00000000000a", workspaceId: "a0000000-0000-4000-8000-0000000000aa" };
const B = { userId: "b0000000-0000-4000-8000-00000000000b", workspaceId: "b0000000-0000-4000-8000-0000000000bb" };
const A_PLACE = "a0000000-0000-4000-8000-00000000a1ce";
const place = { id: A_PLACE, name: "Synthetic A place", latitude: 51.5, longitude: -0.1, radiusMeters: 100 };
const key = (o: typeof A) => `${o.workspaceId}:${o.userId}`;
const T0 = Date.parse("2026-09-30T08:00:00.000Z");
const bootstrap = (o: typeof A, places: unknown[] = [], mode: LocationRolloutMode = "v2_shadow") => ({
  user: { id: o.userId, email: "x@example.test", name: "x" }, workspace: { id: o.workspaceId, name: "w" },
  locationRolloutMode: mode, places, learnedPlaces: []
}) as never;
const fix = (ms: number, lon = -0.1) => ({ coords: { latitude: 51.5, longitude: lon, accuracy: 5, altitude: 10, speed: 0, heading: 0 }, timestamp: ms });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let db: DatabaseSync;
function adapterFor(database: DatabaseSync) {
  const value = {
    execAsync: async (sql: string) => { database.exec(sql); },
    getFirstAsync: async (sql: string, ...args: never[]) => database.prepare(sql).get(...args) ?? null,
    getAllAsync: async (sql: string, ...args: never[]) => database.prepare(sql).all(...args),
    runAsync: async (sql: string, ...args: never[]) => {
      if (database === db && h.beforeRun) await h.beforeRun(sql);
      return database.prepare(sql).run(...args);
    },
    withExclusiveTransactionAsync: async (fn: (t: unknown) => Promise<void>) => {
      database.exec("BEGIN IMMEDIATE");
      try { await fn(value); database.exec("COMMIT"); } catch (e) { database.exec("ROLLBACK"); throw e; }
    }
  };
  return value;
}
const rows = () => db.prepare("select client_evidence_id id, account_key k, occurred_at t from location_evidence_journal order by occurred_at").all() as Array<{ id: string; k: string; t: string }>;
const n = (table: string, k: string) => (db.prepare(`select count(*) n from ${table} where account_key = ?`).get(k) as unknown as { n: number }).n;
const learningTask = () => h.tasks.get("DAYFRAME_LOCATION_LEARNING_TASK")!;

let api: typeof import("./api");
let geofence: typeof import("./geofence");
let account: typeof import("./mobileAccount");
let session: typeof import("./secure-session");
let store: typeof import("./location/store");
let runtime: typeof import("./location/runtime");
let routes: Record<string, (init: RequestInit) => Response | Promise<Response>>;
const calls: string[] = [];

async function settle() { await runtime.withLocationCaptureLifecycle(async () => undefined); await new Promise(r => setTimeout(r, 0)); await runtime.withLocationCaptureLifecycle(async () => undefined); }
async function signInThroughApi(owner: typeof A, places: unknown[] = [], enable = true, mode: LocationRolloutMode = "v2_shadow") {
  routes["/api/auth/login"] = () => json({ token: `token-${owner.userId.slice(0, 1)}-${Date.now()}`, user: { id: owner.userId, email: "x@example.test", name: "x" }, workspace: { id: owner.workspaceId, name: "w" } });
  await api.login("x@example.test", "synthetic");
  await runtime.configureLocationIntelligence(bootstrap(owner, places, mode));     // Dashboard refreshLocationServices
  await geofence.refreshGeofencesForPlaces(places as never, owner);
  if (enable) await geofence.setLocationLearningEnabled(true, places as never, owner);
}

beforeEach(async () => {
  h.beforeRun = null; h.cleanupFailure = false;
  vi.resetModules(); h.tasks.clear(); h.asyncStore.clear(); h.secure.clear(); h.nativeSignals = []; h.nativeCalls.length = 0; h.dbs.clear(); calls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(T0);
  db = new DatabaseSync(":memory:");
  h.open.mockImplementation(async (name: string) => {
    if (name === "dayframe-location-v2.db") return adapterFor(db);
    if (!h.dbs.has(name)) h.dbs.set(name, new DatabaseSync(":memory:"));
    return adapterFor(h.dbs.get(name)!);
  });
  routes = { "/api/auth/logout": () => json({ ok: true }) };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname; calls.push(path);
    const route = routes[path];
    if (!route) throw new TypeError("Network request failed");
    return route(init);
  }));
  geofence = await import("./geofence");
  account = await import("./mobileAccount");
  session = await import("./secure-session");
  store = await import("./location/store");
  runtime = await import("./location/runtime");
  api = await import("./api");
});
afterEach(async () => {
  await settle(); db.close();
  for (const database of h.dbs.values()) database.close();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const localTables = ["location_evidence_journal", "location_upload_outbox", "location_account_context", "location_engine_state", "location_segment_snapshot"];
const counts = (owner = A) => localTables.map(table => n(table, key(owner)));

describe("Location logout and authentication — real API and SQLite", () => {
  it.each(["enabled", "opted out", "no binding"])("explicit logout deletes the captured owner with %s capture and is idempotent (E1/E3/P2)", async state => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    await store.prepareLocationUploadBatch(A);
    if (state !== "enabled") await geofence.setLocationLearningEnabled(false, [place], A);
    if (state === "no binding") await runtime.endLocationCaptureOwnership("no_owner", A);
    expect(n("location_upload_outbox", key(A))).toBe(1);
    if (state === "no binding") expect(await store.readLocationCaptureBinding()).toBeNull();
    h.nativeCalls.length = 0;
    await api.logout(); await settle();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
    expect(await session.getSessionToken()).toBeNull();
    expect(await account.readActiveMobileAccount()).toBeNull();
    expect(await store.readLocationCaptureBinding()).toBeNull();
    expect(h.nativeCalls).toEqual(expect.arrayContaining(["expo:stopLocationUpdates", "expo:stopGeofencing", "stopMonitoring", "clearAllSignals"]));
    expect([...h.asyncStore.keys()].filter(k => k.includes(`:account:https%3A%2F%2Ffixture.invalid:${key(A)}`) && !k.startsWith("dayframe.location.learning.enabled"))).toEqual([]);
    await api.logout(); await settle();
    await learningTask()({ data: { locations: [fix(T0 + 60_000)] }, error: null });
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
  });

  it("Dashboard configure/refresh and callbacks cannot recreate data during the whole real logout (E4)", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const blocked = deferred(), entered = deferred();
    routes["/api/auth/logout"] = async () => { entered.resolve(); await blocked.promise; return json({ ok: true }); };
    const logout = api.logout();
    await entered.promise;
    h.nativeCalls.length = 0;
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    await geofence.refreshGeofencesForPlaces([place], A);
    await geofence.setLocationLearningEnabled(true, [place], A);
    await learningTask()({ data: { locations: [fix(T0 + 4_000)] }, error: null });
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
    expect(h.nativeCalls.filter(c => c.startsWith("expo:start") || c === "startMonitoring")).toEqual([]);
    blocked.resolve(); await logout; await settle();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
  });

  it("a bound secure-session owner still identifies logout data if the mobile capture owner/binding was already cleared", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    await store.prepareLocationUploadBatch(A);
    await runtime.endLocationCaptureOwnership("no_owner", A);
    await account.deactivateMobileAccount(A); await settle();
    expect(await store.readLocationCaptureBinding()).toBeNull();
    expect(await account.readActiveMobileAccount()).toBeNull();
    expect((await session.readAuthenticatedSessionSnapshot()).status).toBe("authenticated");
    expect(n("location_upload_outbox", key(A))).toBe(1);
    await api.logout(); await settle();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
    expect(await session.getSessionToken()).toBeNull();
  });

  it("contradictory account/session owners cannot report successful local logout cleanup", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    await account.activateMobileAccount(B); await settle();
    const token = await session.getSessionToken();
    const binding = await store.readLocationCaptureBinding();
    await expect(api.logout()).rejects.toMatchObject({ name: "StaleMobileSessionResponseError" });
    expect(await session.getSessionToken()).toBe(token);
    expect(await store.readLocationCaptureBinding()).toEqual(binding);
    expect(rows()).toHaveLength(1);
    expect(calls).not.toContain("/api/auth/logout");
  });

  it("a concurrent opt-out honours off consent without cancelling the logout deletion generation", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const blocked = deferred(), entered = deferred();
    h.beforeRun = async sql => { if (sql.startsWith("delete from location_evidence_journal")) { entered.resolve(); await blocked.promise; } };
    const logout = api.logout();
    await entered.promise;
    const revision = store.locationCaptureRevision();
    const optOut = geofence.setLocationLearningEnabled(false, [place], A);
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(store.locationCaptureRevision()).toBe(revision);
    blocked.resolve(); h.beforeRun = null;
    await logout; await optOut; await settle();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
    expect(await session.getSessionToken()).toBeNull();
  });

  it.each([B, A])("a late logout response cannot stop or delete replacement owner $userId (E6)", async next => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const blocked = deferred(), entered = deferred();
    routes["/api/auth/logout"] = async () => { entered.resolve(); await blocked.promise; return json({ ok: true }); };
    const logout = api.logout().catch((error: Error) => error.name);
    await entered.promise;
    vi.setSystemTime(T0 + 60_000);
    await signInThroughApi(next, [place]);
    const replacementToken = await session.getSessionToken();
    const replacementBinding = await store.readLocationCaptureBinding();
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    h.nativeCalls.length = 0;
    blocked.resolve();
    expect(await logout).toBe("StaleMobileSessionResponseError");
    await settle();
    expect(await session.getSessionToken()).toBe(replacementToken);
    expect(await account.readActiveMobileAccount()).toEqual(next);
    expect(await store.readLocationCaptureBinding()).toEqual(replacementBinding);
    expect(rows()).toEqual([expect.objectContaining({ k: key(next), t: new Date(T0 + 61_000).toISOString() })]);
    expect(h.nativeCalls.filter(c => c.includes("stop") || c === "clearAllSignals")).toEqual([]);
  });

  it.each([B, A])("a replacement session during the deletion transaction rolls back old cleanup for $userId", async next => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const accepted = rows()[0].id;
    const blocked = deferred(), entered = deferred();
    h.beforeRun = async sql => { if (sql.startsWith("delete from location_evidence_journal")) { entered.resolve(); await blocked.promise; } };
    const logout = api.logout().catch((error: Error) => error.name);
    await entered.promise;
    // Use the real secure-session setter to replace the generation while the
    // existing Location queue is held. New capture binds after rollback.
    vi.setSystemTime(T0 + 60_000);
    await session.setSessionToken("replacement-token", next);
    await account.activateMobileAccount(next);
    blocked.resolve(); h.beforeRun = null;
    expect(await logout).toBe("StaleMobileSessionResponseError");
    await runtime.bindLocationCaptureOwner(next); await settle();
    expect(rows().map(r => r.id)).toContain(accepted);
    expect(await session.getSessionToken()).toBe("replacement-token");
    await runtime.configureLocationIntelligence(bootstrap(next, [place]));
    await geofence.setLocationLearningEnabled(true, [place], next);
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    expect(rows().some(r => r.k === key(next) && r.t === new Date(T0 + 61_000).toISOString())).toBe(true);
  });

  it("storage failure rejects logout, rolls back data removal and fences bootstrap until a successful retry", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    h.beforeRun = async sql => { if (sql.startsWith("delete from location_upload_outbox")) throw new Error("Synthetic SQLite failure"); };
    await expect(api.logout()).rejects.toThrow("Synthetic SQLite failure");
    h.beforeRun = null;
    expect(rows()).toHaveLength(1);
    expect(await session.getSessionToken()).not.toBeNull();
    expect(calls).not.toContain("/api/auth/logout");
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    await learningTask()({ data: { locations: [fix(T0 + 5_000)] }, error: null });
    expect(rows()).toHaveLength(1);
    await api.logout(); await settle();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
  });

  it("native cleanup failure is reported, admission remains closed, and a later logout retry completes", async () => {
    await signInThroughApi(A, [place]);
    h.cleanupFailure = true;
    await expect(api.logout()).rejects.toThrow("Local Location cleanup failed");
    expect(await session.getSessionToken()).not.toBeNull();
    expect(await store.readLocationCaptureBinding()).toBeNull();
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    expect(await store.readLocationCaptureBinding()).toBeNull();
    h.cleanupFailure = false;
    await api.logout(); await settle();
    expect(await session.getSessionToken()).toBeNull();
  });

  it("real 401 retains accepted A evidence, B cannot send it and reauthenticated A resumes it (E2)", async () => {
    await signInThroughApi(A, [place]);
    routes["/api/location/evidence"] = () => json({ error: "unauthorized" }, 401);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const accepted = rows()[0].id;
    await store.syncLocationEvidence({ forceUploadRetry: true }); await settle();
    expect(await session.getSessionToken()).toBeNull();
    expect(await account.readActiveMobileAccount()).toBeNull();
    expect(rows()).toHaveLength(1);
    const uploads: Array<{ bearer: string; ids: string[] }> = [];
    routes["/api/location/evidence"] = init => {
      const body = JSON.parse(String(init.body));
      const ids = body.evidence.map((e: { clientEvidenceId: string }) => e.clientEvidenceId);
      uploads.push({ bearer: String((init.headers as Record<string, string>).Authorization), ids });
      return json({ ok: true, acknowledgedEvidenceIds: ids, rolloutMode: "v2_shadow", warnings: [] });
    };
    vi.setSystemTime(T0 + 60_000); await signInThroughApi(B);
    const tokenB = await session.getSessionToken();
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    await store.syncLocationEvidence({ forceUploadRetry: true }); await settle();
    expect(uploads.filter(u => u.bearer === `Bearer ${tokenB}`).flatMap(u => u.ids)).not.toContain(accepted);
    await api.logout(); await settle();
    expect(rows().map(r => r.k)).toEqual([key(A)]);
    vi.setSystemTime(T0 + 120_000); await signInThroughApi(A, [place]);
    const tokenA2 = await session.getSessionToken();
    await store.syncLocationEvidence({ forceUploadRetry: true }); await settle();
    expect(uploads.filter(u => u.bearer === `Bearer ${tokenA2}`).flatMap(u => u.ids)).toContain(accepted);
    expect(db.prepare("select upload_state s from location_evidence_journal where client_evidence_id=?").get(accepted)!.s).toBe("acknowledged");
  });

  it("offline transport and retryable server errors preserve capture and authentication (E5)", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    await settle();
    routes["/api/location/evidence"] = () => json({ error: "busy" }, 503);
    vi.setSystemTime(T0 + 120_000);
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    await store.syncLocationEvidence({ forceUploadRetry: true }); await settle();
    expect(rows()).toHaveLength(2);
    expect(await session.getSessionToken()).not.toBeNull();
    expect((await store.readLocationCaptureBinding())!.enabled).toBe(true);
  });

  it("a real upload 401 and compatible re-login preserve generated replay cutover values", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    vi.setSystemTime(T0 + 120_000);
    await runtime.configureLocationIntelligence(bootstrap(A, [place], "v2_review"));
    await learningTask()({ data: { locations: [fix(T0 + 180_000)] }, error: null });
    const before = await store.readLocationCaptureBinding();
    routes["/api/location/evidence"] = () => json({ error: "unauthorized" }, 401);
    await store.syncLocationEvidence({ forceUploadRetry: true }); await settle();
    expect(await session.getSessionToken()).toBeNull();
    expect(rows()).toHaveLength(2);
    delete routes["/api/location/evidence"];
    vi.setSystemTime(T0 + 600_000);
    // No incidental shadow bootstrap: the server still acknowledges review.
    await signInThroughApi(A, [place], false, "v2_review");
    const after = (await store.readLocationCaptureBinding())!;
    expect(after.id).not.toBe(before!.id);
    expect(after.boundAt).toBe(new Date(T0 + 600_000).toISOString());
    await store.syncLocationEvidence(); // settle the offline pass started by bootstrap
    const replayBodies: Array<{ rolloutMode: LocationRolloutMode; semanticModeAcknowledgedAt?: string }> = [];
    routes["/api/location/evidence"] = init => {
      const body = JSON.parse(String(init.body));
      return json({ ok: true, acknowledgedEvidenceIds: body.evidence.map((e: { clientEvidenceId: string }) => e.clientEvidenceId), rolloutMode: "v2_review", warnings: [] });
    };
    routes["/api/location/replay"] = init => {
      replayBodies.push(JSON.parse(String(init.body)));
      return json({ ok: true, clientAcknowledgedMode: true, replayVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
        rolloutMode: "v2_review", finalisedSegmentCount: 0, semanticSegmentCount: 0, warnings: [] });
    };
    const synced = await store.syncLocationEvidence({ forceReplay: true, forceUploadRetry: true }); await settle();
    expect(synced).toMatchObject({ replayed: true });
    const replay = replayBodies.at(-1)!;
    expect(replay.semanticModeAcknowledgedAt).toBe(new Date(T0 + 120_000).toISOString());
    const decision = decideLocationRollout("v2_review", replay.rolloutMode, replay.semanticModeAcknowledgedAt);
    expect(decision.emitV2ReviewItems).toBe(true);
    expect(segmentStartedAfterSemanticCutover(new Date(T0 + 180_000).toISOString(), decision.semanticCutoverAt!)).toBe(true);
    expect(segmentStartedAfterSemanticCutover(new Date(T0 + 1_000).toISOString(), decision.semanticCutoverAt!)).toBe(false);
    expect(decideLocationRollout("v2_shadow", replay.rolloutMode, replay.semanticModeAcknowledgedAt).emitV2ReviewItems).toBe(false);
  });
});
