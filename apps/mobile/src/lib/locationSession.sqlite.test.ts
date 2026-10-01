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
  cleanupFailure: false,
  onRemove: null as ((key: string) => Promise<void>) | null,
  onSet: null as ((key: string, value: string) => Promise<void>) | null
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
    setItem: vi.fn(async (k: string, v: string) => { if (h.onSet) await h.onSet(k, v); h.asyncStore.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { if (h.onRemove) await h.onRemove(k); h.asyncStore.delete(k); })
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
  vi.mocked((await import("expo-location")).hasStartedLocationUpdatesAsync).mockResolvedValue(true);
  h.beforeRun = null; h.cleanupFailure = false; h.onRemove = null; h.onSet = null;
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
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
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

// Claude's R-1 B4/B4b, R-2 B11 and R-3 A4/A4b observations are contracts here.
// Gates force the actual storage/queue window; no session/account/store doubles.
const consentKey = (owner = A) => `dayframe.location.learning.enabled.v1:account:https%3A%2F%2Ffixture.invalid:${key(owner)}`;
function osState() {
  const state = { learning: false, geofencing: false, native: false };
  for (const call of h.nativeCalls) {
    if (call === "expo:startLocationUpdates") state.learning = true;
    if (call === "expo:stopLocationUpdates") state.learning = false;
    if (call === "expo:startGeofencing") state.geofencing = true;
    if (call === "expo:stopGeofencing") state.geofencing = false;
    if (call === "startMonitoring") state.native = true;
    if (call === "stopMonitoring") state.native = false;
  }
  return state;
}
const stopped = { learning: false, geofencing: false, native: false };
const running = { learning: true, geofencing: true, native: true };
async function dashboardBootstrap() {
  const result = await api.fetchBootstrap();
  await runtime.configureLocationIntelligence(result);
  await geofence.refreshGeofencesForPlaces(result.places, { userId: result.user.id, workspaceId: result.workspace.id });
}

describe("PR 213 residual lifecycle regressions", () => {
  it.each([[true, false], [false, false], [true, true]])("R-1 refuses the departing bootstrap inside final account removal (screen applies: %s, legacy token: %s)", async (apply, legacy) => {
    vi.stubEnv("VITEST", ""); // exercise the real Review projection as well
    await signInThroughApi(A, [place]);
    if (legacy) await session.setSessionToken("legacy-ownerless-token");
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const response = deferred(), activationAttempted = deferred();
    routes["/api/bootstrap"] = async () => {
      await response.promise;
      return json({ ...(bootstrap(A, [place]) as object), entries: [], categories: [], reviewItems: [] });
    };
    const activate = account.activateMobileAccount;
    const spy = vi.spyOn(account, "activateMobileAccount").mockImplementation(owner => {
      activationAttempted.resolve();
      return activate(owner);
    });
    const caller = (apply ? dashboardBootstrap() : api.fetchBootstrap()).then(() => "applied", (error: Error) => error.name);
    let used = false;
    h.onRemove = async k => {
      if (used || k !== "dayframe.activeMobileAccount.v1") return;
      used = true;
      response.resolve();
      // Old code queues activation behind this remove; fixed code rejects it.
      await Promise.race([activationAttempted.promise, caller]);
    };
    await api.logout();
    await caller; await settle();
    spy.mockRestore();
    expect(used).toBe(true);
    expect(await caller).toBe("StaleMobileSessionResponseError");
    expect(await session.getSessionToken()).toBeNull();
    expect(await account.readActiveMobileAccount()).toBeNull();
    expect(await store.readLocationCaptureBinding()).toBeNull();
    await learningTask()({ data: { locations: [fix(T0 + 4_000)] }, error: null });
    (await import("./mobileSessionTransition")).publishMobileSignedOut();
    await settle();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
    expect(osState()).toEqual(stopped);
    const reviewDb = h.dbs.get("dayframe-review-sync.db");
    expect(reviewDb).toBeDefined();
    for (const table of ["review_account_context", "review_item_cache"]) {
      expect((reviewDb!.prepare(`select count(*) n from ${table}`).get() as { n: number }).n).toBe(0);
    }
  });

  it.each(["logout", "401"] as const)("R-2 stores a queued authorised opt-out overtaken by %s; A returns off", async event => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const accepted = rows()[0].id;
    const blocked = deferred(), entered = deferred();
    const lane = runtime.withLocationCaptureLifecycle(async () => { entered.resolve(); await blocked.promise; });
    await entered.promise;
    const revision = store.locationCaptureRevision();
    const off = geofence.setLocationLearningEnabled(false, [place], A);
    await vi.waitFor(() => expect(store.locationCaptureRevision()).toBeGreaterThan(revision));
    let departing: Promise<unknown>;
    if (event === "logout") {
      departing = api.logout();
      await vi.waitFor(() => expect(store.locationCaptureRevision()).toBeGreaterThan(revision + 1));
    } else {
      routes["/api/timer-state"] = () => json({ error: "unauthorized" }, 401);
      departing = api.fetchTimerState().catch((error: Error) => error.name);
      await vi.waitFor(async () => expect(await session.getSessionToken()).toBeNull());
    }
    blocked.resolve(); await lane; await departing; await off; await settle();
    expect(h.asyncStore.get(consentKey())).toBe("false");
    expect(rows().some(row => row.id === accepted)).toBe(event === "401");
    vi.setSystemTime(T0 + 60_000);
    await signInThroughApi(A, [place], false);
    expect(await geofence.getLocationLearningEnabled()).toBe(false);
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(false);
    expect(osState()).toEqual(stopped);
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    expect(rows().some(row => row.t === new Date(T0 + 61_000).toISOString())).toBe(false);
  });

  it.each([false, true])("R-3 reconciles durable off after interrupted opt-out (headless restart: %s)", async restart => {
    await signInThroughApi(A, [place], true, "v2_review");
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const accepted = rows()[0].id;
    const eligibility = db.prepare("select value from location_store_metadata where key=?").get(`semantic_eligibility:${key(A)}`);
    await geofence.writeLocationLearningPreference(A, false); // process stopped before binding/OS steps
    if (restart) {
      vi.resetModules(); h.tasks.clear();
      geofence = await import("./geofence"); account = await import("./mobileAccount"); session = await import("./secure-session");
      store = await import("./location/store"); runtime = await import("./location/runtime"); api = await import("./api");
    }
    // Learning alone must reconcile, without a geofence callback or mounted UI.
    await learningTask()({ data: { locations: [fix(T0 + 2_000)] }, error: null });
    await settle();
    expect(osState()).toEqual(stopped);
    expect(rows().map(row => row.id)).toEqual([accepted]);
    await runtime.configureLocationIntelligence(bootstrap(A, [place], "v2_review"));
    await geofence.refreshGeofencesForPlaces([place], A);
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(false);
    expect(osState()).toEqual(stopped);
    expect(db.prepare("select value from location_store_metadata where key=?").get(`semantic_eligibility:${key(A)}`)).toEqual(eligibility);
    expect((await store.prepareLocationUploadBatch(A, { forceUploadRetry: true }))?.body_json).toContain(accepted);
  });
});

// Related failure/replacement controls for the same three residuals.
describe("residual lifecycle ordering and failure controls", () => {
  it.each([B, A])("R-1 genuine replacement $userId during account-removal I/O keeps its session and bootstrap", async next => {
    await signInThroughApi(A, [place]);
    const blocked = deferred(), entered = deferred();
    let used = false;
    h.onRemove = async k => {
      if (used || k !== "dayframe.activeMobileAccount.v1") return;
      used = true; entered.resolve(); await blocked.promise;
    };
    const logout = api.logout().catch((error: Error) => error.name);
    await entered.promise;
    vi.setSystemTime(T0 + 60_000);
    routes["/api/auth/login"] = () => json({ token: "new-session", user: { id: next.userId }, workspace: { id: next.workspaceId } });
    const login = api.login("x@example.test", "synthetic");
    await vi.waitFor(async () => expect(await session.getSessionToken()).toBe("new-session"));
    blocked.resolve(); await login;
    expect(await logout).toBe("StaleMobileSessionResponseError");
    routes["/api/bootstrap"] = () => json({ ...(bootstrap(next, [place]) as object), entries: [], categories: [], reviewItems: [] });
    await dashboardBootstrap();
    await geofence.setLocationLearningEnabled(true, [place], next);
    const binding = await store.readLocationCaptureBinding();
    await settle();
    expect(await session.getSessionToken()).toBe("new-session");
    expect(await account.readActiveMobileAccount()).toEqual(next);
    expect(binding).toMatchObject({ accountKey: key(next), enabled: true });
    expect(osState()).toEqual(running);
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    expect(rows()).toEqual([expect.objectContaining({ k: key(next) })]);
  });

  it("R-1 blocks departing bootstrap activation when logout starts without a Location binding", async () => {
    await signInThroughApi(A, [place]);
    await runtime.endLocationCaptureOwnership("no_owner", A);
    expect(await store.readLocationCaptureBinding()).toBeNull();
    const entered = deferred(), blocked = deferred();
    routes["/api/auth/logout"] = async () => { entered.resolve(); await blocked.promise; return json({ ok: true }); };
    const logout = api.logout();
    await entered.promise;
    routes["/api/bootstrap"] = () => json({ ...(bootstrap(A, [place]) as object), entries: [], categories: [], reviewItems: [] });
    await expect(dashboardBootstrap()).rejects.toMatchObject({ name: "StaleMobileSessionResponseError" });
    blocked.resolve(); await logout; await settle();
    expect(counts()).toEqual([0, 0, 0, 0, 0]);
    expect(await account.readActiveMobileAccount()).toBeNull();
  });

  it.each([B, A])("R-2 pending A off cannot overwrite a newer authorised opt-in or affect $userId", async next => {
    await signInThroughApi(A, [place]);
    const oldCapture = await store.captureLocationOwnership();
    await geofence.writeLocationLearningPreference(B, true); // previously authorised B consent
    const blocked = deferred(), entered = deferred();
    const lane = runtime.withLocationCaptureLifecycle(async () => { entered.resolve(); await blocked.promise; });
    await entered.promise;
    const revision = store.locationCaptureRevision();
    const off = geofence.setLocationLearningEnabled(false, [place], A);
    await vi.waitFor(() => expect(store.locationCaptureRevision()).toBeGreaterThan(revision));
    vi.setSystemTime(T0 + 60_000);
    routes["/api/auth/login"] = () => json({ token: "new-session", user: { id: next.userId }, workspace: { id: next.workspaceId } });
    const login = api.login("x@example.test", "synthetic");
    await vi.waitFor(async () => {
      expect(await session.getSessionToken()).toBe("new-session");
      expect(await account.readActiveMobileAccount()).toEqual(next);
    });
    const on = geofence.setLocationLearningEnabled(true, [place], next);
    blocked.resolve(); await lane; await off; await login; await on;
    await runtime.configureLocationIntelligence(bootstrap(next, [place]));
    await settle();
    expect(h.asyncStore.get(consentKey(A))).toBe(next === A ? "true" : "false");
    expect(h.asyncStore.get(consentKey(B))).toBe("true");
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(true);
    expect(osState()).toEqual(running);
    const callsBefore = h.nativeCalls.length;
    await runtime.stopUnownedLocationCapture(oldCapture);
    if (next === B) await geofence.setLocationLearningEnabled(false, [place], A); // stale screen
    await settle();
    expect(h.nativeCalls.slice(callsBefore).filter(c => c.includes("stop") || c === "clearAllSignals")).toEqual([]);
    expect(osState()).toEqual(running);
  });

  it("R-2 preference failure rejects the toggle, keeps admission closed through bootstrap, and permits explicit retry", async () => {
    await signInThroughApi(A, [place]);
    h.onSet = async (k, value) => { if (k === consentKey() && value === "false") throw new Error("Synthetic consent storage failure"); };
    await expect(geofence.setLocationLearningEnabled(false, [place], A)).rejects.toThrow("Synthetic consent storage failure");
    h.onSet = null;
    expect(h.asyncStore.get(consentKey())).toBe("true"); // no false durable-success claim
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(false);
    expect(osState()).toEqual(stopped);
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    await geofence.refreshGeofencesForPlaces([place], A);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    expect(rows()).toEqual([]);
    expect(osState()).toEqual(stopped);
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(false);
    vi.setSystemTime(T0 + 60_000);
    await geofence.setLocationLearningEnabled(true, [place], A);
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(true);
    expect(osState()).toEqual(running);
  });

  it("R-3 SQLite failure after durable off still attempts every OS stop and recovers without losing accepted data", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const accepted = rows()[0].id;
    h.beforeRun = async sql => { if (sql.includes("insert into location_account_context")) throw new Error("Synthetic post-consent SQLite failure"); };
    h.nativeCalls.length = 0;
    await expect(geofence.setLocationLearningEnabled(false, [place], A)).rejects.toThrow("Synthetic post-consent SQLite failure");
    h.beforeRun = null;
    expect(h.asyncStore.get(consentKey())).toBe("false");
    expect(h.nativeCalls).toEqual(expect.arrayContaining(["expo:stopLocationUpdates", "expo:stopGeofencing", "stopMonitoring", "clearAllSignals"]));
    await learningTask()({ data: { locations: [fix(T0 + 2_000)] }, error: null });
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    expect(rows().map(row => row.id)).toEqual([accepted]);
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(false);
    expect(osState()).toEqual(stopped);
  });

  it("R-3 a real 401 after off is persisted cancels capture work but still reconciles OS teardown", async () => {
    await signInThroughApi(A, [place]);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const accepted = rows()[0].id;
    let used = false;
    h.onSet = async (k, value) => {
      if (used || k !== consentKey() || value !== "false") return;
      used = true; h.asyncStore.set(k, value); // durable edge before invalidation
      routes["/api/timer-state"] = () => json({ error: "unauthorized" }, 401);
      await api.fetchTimerState().catch(() => undefined);
    };
    await geofence.setLocationLearningEnabled(false, [place], A); await settle();
    h.onSet = null;
    expect(used).toBe(true);
    expect(h.asyncStore.get(consentKey())).toBe("false");
    expect(await session.getSessionToken()).toBeNull();
    expect(await account.readActiveMobileAccount()).toBeNull();
    expect(osState()).toEqual(stopped);
    expect(rows().map(row => row.id)).toEqual([accepted]);
  });

  it("R-3 OS failure reports incomplete cleanup and a later disabled callback retries it", async () => {
    await signInThroughApi(A, [place]);
    const location = await import("expo-location");
    vi.mocked(location.stopLocationUpdatesAsync).mockRejectedValueOnce(new Error("Synthetic OS stop failure"));
    await expect(geofence.setLocationLearningEnabled(false, [place], A)).rejects.toThrow("some local capture cleanup failed");
    expect(h.asyncStore.get(consentKey())).toBe("false");
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(false);
    expect(osState()).toEqual({ learning: true, geofencing: false, native: false });
    expect((await store.getLocationStoreDiagnostics()).captureCleanupFailureCount).toBeGreaterThan(0);
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    await settle();
    expect(osState()).toEqual(stopped);
    expect(rows()).toEqual([]);
  });
});

describe("opt-out OS lane reconciliation controls", () => {
  it.each([B, A])("R-3 in-flight A stop finishes before authorised replacement $userId starts", async next => {
    await signInThroughApi(A, [place]);
    const blocked = deferred(), entered = deferred();
    const location = await import("expo-location");
    vi.mocked(location.stopLocationUpdatesAsync).mockImplementationOnce(async () => {
      entered.resolve(); await blocked.promise; h.nativeCalls.push("expo:stopLocationUpdates");
    });
    const off = geofence.setLocationLearningEnabled(false, [place], A);
    await entered.promise;
    expect(h.asyncStore.get(consentKey())).toBe("false");
    vi.setSystemTime(T0 + 60_000);
    routes["/api/auth/login"] = () => json({ token: "new-session", user: { id: next.userId }, workspace: { id: next.workspaceId } });
    const login = api.login("x@example.test", "synthetic");
    await vi.waitFor(async () => {
      expect(await session.getSessionToken()).toBe("new-session");
      expect(await account.readActiveMobileAccount()).toEqual(next);
    });
    const on = geofence.setLocationLearningEnabled(true, [place], next);
    blocked.resolve(); await off; await login; await on; await settle();
    const binding = await store.readLocationCaptureBinding();
    expect(binding).toMatchObject({ accountKey: key(next), enabled: true });
    expect(osState()).toEqual(running);
    const finalStop = h.nativeCalls.findLastIndex(c => c.includes("stop") || c === "clearAllSignals");
    const finalStart = h.nativeCalls.findLastIndex(c => c === "startMonitoring");
    expect(finalStop).toBeLessThan(finalStart);
    const before = h.nativeCalls.length;
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null }); await settle();
    expect(h.nativeCalls.slice(before).filter(c => c.includes("stop") || c === "clearAllSignals")).toEqual([]);
    expect(rows()).toEqual([expect.objectContaining({ k: key(next) })]);
  });

  it("R-3 foreground bootstrap alone reconciles interrupted durable off without waiting for a callback", async () => {
    await signInThroughApi(A, [place]);
    await geofence.writeLocationLearningPreference(A, false);
    expect(osState()).toEqual(running);
    await runtime.configureLocationIntelligence(bootstrap(A, [place]));
    await geofence.refreshGeofencesForPlaces([place], A);
    expect(osState()).toEqual(stopped);
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(false);
    expect(h.asyncStore.get(consentKey())).toBe("false");
  });
});

// Claude's O-1/O-2 observations become recovery contracts, using the same real
// API/session/account/runtime/SQLite path as Dashboard and Settings.
describe("failed Location operation recovery", () => {
  const responseFor = (owner = A) => json({ ...(bootstrap(owner, [place]) as object), entries: [], categories: [], reviewItems: [] });
  beforeEach(async () => {
    // Realistic start/stop projection for the recovery assertions. Legacy
    // fixtures elsewhere clear the call log and intentionally report started.
    vi.mocked((await import("expo-location")).hasStartedLocationUpdatesAsync).mockImplementation(async () => osState().learning);
  });

  it.each([["sqlite", false], ["native", false], ["sqlite", true], ["native", true]] as const)(
    "failed logout permits fresh screen reads but keeps capture closed (%s, legacy token: %s)", async (failure, legacy) => {
      vi.stubEnv("VITEST", ""); // include the real Review bootstrap projection
      await signInThroughApi(A, [place]);
      if (legacy) await session.setSessionToken("legacy-ownerless-token");
      await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
      if (failure === "sqlite") h.beforeRun = async sql => { if (sql.startsWith("delete from location_upload_outbox")) throw new Error("Synthetic SQLite failure"); };
      else h.cleanupFailure = true;
      await expect(api.logout()).rejects.toThrow(failure === "sqlite" ? "Synthetic SQLite failure" : "Local Location cleanup failed");
      h.beforeRun = null; h.cleanupFailure = false;
      const binding = await store.readLocationCaptureBinding(), retained = rows();
      const from = h.nativeCalls.length;
      routes["/api/bootstrap"] = () => responseFor();
      await dashboardBootstrap();
      await dashboardBootstrap(); // a subsequent Settings/Dashboard refresh also works
      expect(await store.readLocationCaptureBinding()).toEqual(binding);
      expect(await geofence.getLocationVisitDiagnostics()).toMatchObject({ locationLearningActive: false, locationLearningCaptureState: "logout_cleanup" });
      await learningTask()({ data: { locations: [fix(T0 + 5_000)] }, error: null });
      await settle();
      expect(await session.getSessionToken()).not.toBeNull();
      expect(rows()).toEqual(retained);
      expect(h.nativeCalls.slice(from).filter(c => c.startsWith("expo:start") || c === "startMonitoring")).toEqual([]);
      // Fresh reads must not release the unresolved capture cleanup fence,
      // including legacy owner binding during the refresh.
      expect(await geofence.setLocationLearningEnabled(true, [place], A)).toBe("Location account changed.");
      await api.logout(); await settle();
      expect(counts()).toEqual([0, 0, 0, 0, 0]);
      expect(await session.getSessionToken()).toBeNull();
    }
  );

  it("failed logout never revives responses begun before or during its active request", async () => {
    await signInThroughApi(A, [place]);
    const response = deferred(), fetched = deferred(), cleanup = deferred(), entered = deferred();
    routes["/api/bootstrap"] = async () => { fetched.resolve(); await response.promise; return responseFor(); };
    const before = api.fetchBootstrap().then(() => "applied", (e: Error) => e.name);
    await fetched.promise;
    h.beforeRun = async sql => { if (sql.startsWith("delete from location_upload_outbox")) { entered.resolve(); await cleanup.promise; throw new Error("Synthetic SQLite failure"); } };
    const logout = api.logout().catch((e: Error) => e.message);
    await entered.promise;
    const during = api.fetchBootstrap().then(() => "applied", (e: Error) => e.name);
    cleanup.resolve();
    expect(await logout).toContain("Synthetic SQLite failure"); h.beforeRun = null;
    response.resolve();
    expect(await before).toBe("StaleMobileSessionResponseError");
    expect(await during).toBe("StaleMobileSessionResponseError");
    routes["/api/bootstrap"] = () => responseFor();
    await dashboardBootstrap();
    expect(await session.getSessionToken()).not.toBeNull();
  });

  it.each([B, A])("failed old logout cannot gate a genuinely newer $userId session", async next => {
    await signInThroughApi(A, [place]);
    h.cleanupFailure = true;
    await expect(api.logout()).rejects.toThrow("Local Location cleanup failed");
    h.cleanupFailure = false;
    vi.setSystemTime(T0 + 60_000); await signInThroughApi(next, [place]);
    routes["/api/bootstrap"] = () => responseFor(next);
    await dashboardBootstrap();
    await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
    expect(await account.readActiveMobileAccount()).toEqual(next);
    expect(osState()).toEqual(running);
    expect(rows()).toEqual([expect.objectContaining({ k: key(next) })]);
  });

  it.each([false, true])("interrupted opt-in stays honestly inactive through bootstrap and one explicit retry works (restart: %s)", async restart => {
    await signInThroughApi(A, [place], false);
    h.beforeRun = async sql => { if (sql.includes("insert into location_account_context")) throw new Error("Synthetic activation failure"); };
    await expect(geofence.setLocationLearningEnabled(true, [place], A)).rejects.toThrow("Synthetic activation failure");
    h.beforeRun = null;
    expect(h.asyncStore.get(consentKey())).toBe("true");
    expect((await store.readLocationCaptureBinding())?.enabled).toBe(false);
    if (restart) {
      vi.resetModules(); h.tasks.clear();
      geofence = await import("./geofence"); account = await import("./mobileAccount"); session = await import("./secure-session");
      store = await import("./location/store"); runtime = await import("./location/runtime"); api = await import("./api");
    }
    routes["/api/bootstrap"] = () => responseFor();
    await dashboardBootstrap();
    await learningTask()({ data: { locations: [fix(T0 + 1_000)] }, error: null });
    const inactive = await geofence.getLocationVisitDiagnostics();
    expect(inactive).toMatchObject({ locationLearningEnabled: true, locationLearningActive: false, locationLearningCaptureState: "inactive" });
    expect(osState()).toEqual(stopped);
    expect(rows()).toEqual([]);
    expect(h.asyncStore.get(consentKey())).toBe("true");
    // This is the existing Settings retry path; no artificial off/on cycle.
    expect(await geofence.setLocationLearningEnabled(true, [place], A)).toContain("is on");
    expect(await geofence.getLocationVisitDiagnostics()).toMatchObject({ locationLearningEnabled: true, locationLearningActive: true, locationLearningCaptureState: "active" });
    await learningTask()({ data: { locations: [fix(T0 + 5_000)] }, error: null });
    expect(rows()).toHaveLength(1);
    expect(osState()).toEqual(running);
  });

  it("an opt-in whose OS start failed is inactive and can be explicitly retried", async () => {
    await signInThroughApi(A, [place], false);
    const location = await import("expo-location");
    vi.mocked(location.startLocationUpdatesAsync).mockRejectedValueOnce(new Error("Synthetic OS start failure"));
    await expect(geofence.setLocationLearningEnabled(true, [place], A)).rejects.toThrow("Synthetic OS start failure");
    expect(await geofence.getLocationVisitDiagnostics()).toMatchObject({ locationLearningEnabled: true, locationLearningActive: false, locationLearningCaptureState: "inactive" });
    expect(await geofence.setLocationLearningEnabled(true, [place], A)).toContain("is on");
    expect(await geofence.getLocationVisitDiagnostics()).toMatchObject({ locationLearningActive: true, locationLearningCaptureState: "active" });
  });

  it("a later authorised off cancels an interrupted on without losing the off decision", async () => {
    await signInThroughApi(A, [place], false);
    const blocked = deferred(), entered = deferred();
    h.onSet = async (k, v) => { if (k === consentKey() && v === "true") { entered.resolve(); await blocked.promise; } };
    const on = geofence.setLocationLearningEnabled(true, [place], A);
    await entered.promise;
    const off = geofence.setLocationLearningEnabled(false, [place], A);
    // Acceptance invalidates capture synchronously, before queued persistence.
    const revision = store.locationCaptureRevision();
    for (let i = 0; i < 100 && revision === store.locationCaptureRevision(); i++) await Promise.resolve();
    expect(store.locationCaptureRevision()).not.toBe(revision);
    blocked.resolve();
    expect(await on).toBe("Location account changed.");
    expect(await off).toContain("paused"); h.onSet = null;
    expect(h.asyncStore.get(consentKey())).toBe("false");
    expect(await geofence.getLocationVisitDiagnostics()).toMatchObject({ locationLearningEnabled: false, locationLearningActive: false, locationLearningCaptureState: "off" });
    expect(osState()).toEqual(stopped);
  });

  it("an opt-in overtaken during its OS await cannot report working capture after off", async () => {
    await signInThroughApi(A, [place], false);
    const blocked = deferred(), entered = deferred();
    const location = await import("expo-location");
    vi.mocked(location.startLocationUpdatesAsync).mockImplementationOnce(async () => { entered.resolve(); await blocked.promise; h.nativeCalls.push("expo:startLocationUpdates"); });
    const on = geofence.setLocationLearningEnabled(true, [place], A);
    await entered.promise;
    const revision = store.locationCaptureRevision();
    const off = geofence.setLocationLearningEnabled(false, [place], A);
    for (let i = 0; i < 100 && revision === store.locationCaptureRevision(); i++) await Promise.resolve();
    expect(store.locationCaptureRevision()).not.toBe(revision);
    blocked.resolve();
    expect(await on).toBe("Location account changed.");
    expect(await off).toContain("paused");
    expect(await geofence.getLocationVisitDiagnostics()).toMatchObject({ locationLearningEnabled: false, locationLearningActive: false, locationLearningCaptureState: "off" });
    expect(osState()).toEqual(stopped);
  });

  it.each(["logout", "401", "B", "newer A"])("an old opt-in cannot claim success or affect the lifetime after %s", async event => {
    await signInThroughApi(A, [place], false);
    const blocked = deferred(), entered = deferred();
    const location = await import("expo-location");
    vi.mocked(location.startLocationUpdatesAsync).mockImplementationOnce(async () => { entered.resolve(); await blocked.promise; h.nativeCalls.push("expo:startLocationUpdates"); });
    const on = geofence.setLocationLearningEnabled(true, [place], A);
    await entered.promise;
    const revision = store.locationCaptureRevision();
    const logout = event === "logout" ? api.logout() : null;
    if (event === "401" || event === "newer A") {
      routes["/api/timer-state"] = () => json({ error: "unauthorized" }, 401);
      await expect(api.fetchTimerState()).rejects.toMatchObject({ name: "AuthRequiredError" });
    }
    const next = event === "B" ? B : A;
    let login: Promise<unknown> | null = null;
    if (event === "B" || event === "newer A") {
      const published = deferred();
      const unsubscribe = session.subscribeAuthenticatedSession(() => { published.resolve(); });
      vi.setSystemTime(T0 + 60_000);
      routes["/api/auth/login"] = () => json({ token: "replacement-token", user: { id: next.userId }, workspace: { id: next.workspaceId } });
      login = api.login("x@example.test", "synthetic");
      await published.promise; unsubscribe();
    }
    for (let i = 0; i < 100 && revision === store.locationCaptureRevision(); i++) await Promise.resolve();
    expect(store.locationCaptureRevision()).not.toBe(revision);
    blocked.resolve();
    expect(await on).toBe("Location account changed.");
    if (logout) await logout;
    if (login) {
      await login;
      await runtime.configureLocationIntelligence(bootstrap(next, [place]));
      expect(await geofence.setLocationLearningEnabled(true, [place], next)).toContain("is on");
      await learningTask()({ data: { locations: [fix(T0 + 61_000)] }, error: null });
      expect(rows()).toEqual([expect.objectContaining({ k: key(next) })]);
      expect(osState()).toEqual(running);
    } else {
      await settle();
      expect(await session.getSessionToken()).toBeNull();
      expect(osState()).toEqual(stopped);
      expect(rows()).toEqual([]);
    }
  });
});
