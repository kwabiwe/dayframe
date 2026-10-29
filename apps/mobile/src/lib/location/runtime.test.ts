import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DayframeLocationNativeSignal } from "../../../modules/dayframe-location-visits";
import type { MobileBootstrap } from "../api";
import type { LocationAccountContext, LocationCaptureBinding } from "./store";

const state = vi.hoisted(() => ({
  owner: { userId: "user-a", workspaceId: "workspace-a" },
  binding: null as LocationCaptureBinding | null,
  context: null as LocationAccountContext | null,
  revision: 0,
  mode: "v2_shadow",
  secure: new Map<string, string>()
}));
const mocks = vi.hoisted(() => ({
  configureLocationAccount: vi.fn(),
  drainSignals: vi.fn<(limit: number) => Promise<DayframeLocationNativeSignal[]>>(async () => []),
  clearAllSignals: vi.fn(async () => 0),
  stopMonitoring: vi.fn(async () => ({ enabled: false })),
  refreshLocalJournalReplayIfDue: vi.fn(async () => []),
  recordLocationStoreError: vi.fn(async () => undefined),
  recordLocationCaptureCleanupFailure: vi.fn(async () => undefined),
  syncLocationEvidence: vi.fn(async () => ({ synced: true, acknowledgedCount: 0 })),
  persistLocationEvidence: vi.fn(async (items: unknown[]) => ({ insertedCount: items.length })),
  motionStatus: vi.fn(() => "authorized"),
  queryActivities: vi.fn(async () => [] as unknown[]),
  recordMotionCaptureFailure: vi.fn(async () => undefined)
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => state.secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { state.secure.set(key, value); }
}));
vi.mock("../mobileAccount", () => ({
  readActiveMobileAccount: async () => state.owner,
  getActiveMobileAccountSnapshot: () => state.owner,
  mobileAccountOwnersEqual: (a: typeof state.owner, b: typeof state.owner) => a?.userId === b?.userId && a?.workspaceId === b?.workspaceId,
  deactivateMobileAccount: vi.fn()
}));
const burstMocks = vi.hoisted(() => ({ maybeStartAccuracyBurst: vi.fn(async (..._args: unknown[]) => true) }));
vi.mock("../geofence", () => ({
  migrateLegacyLocationOptIn: async () => undefined,
  getLocationLearningEnabled: async () => true,
  stopLocationLearningIfStarted: async () => undefined,
  stopGeofencesIfStarted: async () => undefined,
  clearLocationCaptureCaches: async () => undefined,
  refreshNearestGeofencesInLifecycleLane: async () => 0,
  maybeStartAccuracyBurst: burstMocks.maybeStartAccuracyBurst
}));
vi.mock("./store", () => ({
  configureLocationAccount: mocks.configureLocationAccount,
  readLocationCaptureBinding: async () => state.binding,
  readOwnedLocationAccountContext: async () => null,
  captureLocationOwnership: async () => ({ revision: state.revision, binding: state.binding, context: state.context }),
  endLocationOwnership: async () => { state.binding = null; state.context = null; return true; },
  invalidateLocationCaptureOwnership: () => ++state.revision,
  locationCaptureRevision: () => state.revision,
  isLocationCaptureSnapshotCurrent: () => Boolean(state.binding?.enabled && state.context),
  isLocationCaptureAdmissionSuspended: () => false,
  getLocationRolloutMode: async () => state.mode,
  persistLocationEvidence: mocks.persistLocationEvidence,
  refreshLocalJournalReplayIfDue: mocks.refreshLocalJournalReplayIfDue,
  recordLocationStoreError: mocks.recordLocationStoreError,
  recordLocationCaptureCleanupFailure: mocks.recordLocationCaptureCleanupFailure,
  recordLocationCaptureDiscard: async () => undefined,
  syncLocationEvidence: mocks.syncLocationEvidence,
  readMotionCaptureState: async () => state.binding ? {
    version: 1, bindingId: state.binding.id, floorMs: Date.parse(state.binding.boundAt), cursor: { lastRecordStartMs: null, last: null }
  } : null,
  recordMotionCaptureFailure: mocks.recordMotionCaptureFailure
}));
vi.mock("../../../modules/dayframe-motion-activity", () => ({
  MAX_MOTION_RECORDS_PER_QUERY: 2_000,
  getAuthorizationStatus: mocks.motionStatus,
  queryActivities: mocks.queryActivities
}));
vi.mock("../../../modules/dayframe-location-visits", () => ({
  clearAllSignals: mocks.clearAllSignals,
  clearSignals: vi.fn(),
  drainSignals: mocks.drainSignals,
  getStatus: vi.fn(),
  startMonitoring: vi.fn(),
  stopMonitoring: mocks.stopMonitoring
}));
const { configureLocationIntelligence, drainNativeLocationSignalsInBatches, refreshLocalJournalReplayForDiagnostics, syncLocationIntelligenceOnForeground } = await import("./runtime");
const { runningJsTasks } = await import("../jsTasks");
function bootstrap(userId = "user-a", workspaceId = "workspace-a", mode: MobileBootstrap["locationRolloutMode"] = "v2_shadow") {
  state.owner = { userId, workspaceId };
  return { user: { id: userId, email: `${userId}@example.test`, name: userId }, workspace: { id: workspaceId, name: workspaceId },
    locationRolloutMode: mode, activeEntry: null, projects: [], categories: [], entries: [], places: [], reviewItems: [] } satisfies MobileBootstrap;
}
describe("location runtime binding and drain", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.secure.clear(); state.binding = null; state.context = null; state.mode = "v2_shadow"; state.revision = 0;
    state.owner = { userId: "user-a", workspaceId: "workspace-a" };
    mocks.clearAllSignals.mockResolvedValue(0); mocks.drainSignals.mockResolvedValue([]);
    mocks.motionStatus.mockReturnValue("authorized"); mocks.queryActivities.mockResolvedValue([]);
    mocks.persistLocationEvidence.mockImplementation(async (items: unknown[]) => ({ insertedCount: items.length }));
    mocks.configureLocationAccount.mockImplementation(async (context: LocationAccountContext, mode: string, enabled: boolean) => {
      state.context = context; state.mode = mode;
      state.binding ??= { id: "capture-test", accountKey: `${context.workspaceId}:${context.userId}`, backend: "https://fixture.invalid", boundAt: "2026-08-11T00:00:00Z", enabled };
      return state.binding.accountKey;
    });
  });
  it("keeps the native journal and cutoff through same-owner bootstrap refresh", async () => {
    await configureLocationIntelligence(bootstrap());
    const binding = state.binding;
    mocks.clearAllSignals.mockClear();
    await configureLocationIntelligence(bootstrap());
    expect(mocks.clearAllSignals).not.toHaveBeenCalled();
    expect(state.binding).toBe(binding);
    // A bootstrap publish never runs the local journal replay (stability audit 22 Oct 2026, location-3).
    expect(mocks.refreshLocalJournalReplayIfDue).not.toHaveBeenCalled();
  });
  it("clears native evidence before binding a different account", async () => {
    await configureLocationIntelligence(bootstrap());
    mocks.configureLocationAccount.mockClear(); mocks.clearAllSignals.mockClear();
    await configureLocationIntelligence(bootstrap("user-b", "workspace-b"));
    expect(mocks.clearAllSignals).toHaveBeenCalledOnce();
    expect(mocks.clearAllSignals.mock.invocationCallOrder[0]).toBeLessThan(mocks.configureLocationAccount.mock.invocationCallOrder[0]);
  });
  it("fails closed and records a cleanup count when native purge fails", async () => {
    await configureLocationIntelligence(bootstrap());
    mocks.configureLocationAccount.mockClear(); mocks.clearAllSignals.mockRejectedValueOnce(new Error("synthetic native purge failure"));
    await configureLocationIntelligence(bootstrap("user-b", "workspace-b"));
    expect(mocks.configureLocationAccount).not.toHaveBeenCalled();
    expect(state.binding).toBeNull();
    expect(mocks.recordLocationCaptureCleanupFailure).toHaveBeenCalledOnce();
  });
  it("stops and clears native capture in explicit server-controlled v1", async () => {
    await configureLocationIntelligence(bootstrap("user-a", "workspace-a", "v1"));
    expect(mocks.stopMonitoring).toHaveBeenCalled(); expect(mocks.clearAllSignals).toHaveBeenCalled();
    expect(mocks.drainSignals).not.toHaveBeenCalled();
  });
  it("does not block bootstrap on location network sync", async () => {
    mocks.syncLocationEvidence.mockImplementationOnce(() => new Promise(() => undefined));
    await expect(configureLocationIntelligence(bootstrap())).resolves.toBeUndefined();
    expect(mocks.syncLocationEvidence).toHaveBeenCalledOnce();
  });
  it("bounds native draining to five 100-item passes", async () => {
    await configureLocationIntelligence(bootstrap());
    mocks.drainSignals.mockClear();
    mocks.drainSignals.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ id: `signal-${index}`, kind: "provider_status", occurredAt: "2026-08-11T12:00:00.000Z", endedAt: null, latitude: null, longitude: null, horizontalAccuracyMeters: null, metadata: {} })));
    expect((await drainNativeLocationSignalsInBatches()).transferredCount).toBe(500);
    expect(mocks.drainSignals).toHaveBeenCalledTimes(5); expect(mocks.drainSignals).toHaveBeenCalledWith(100);
  });
  it("keeps significant-change speed and the native callback clock without replacing sample time", async () => {
    await configureLocationIntelligence(bootstrap());
    mocks.drainSignals.mockResolvedValueOnce([
      { id: "slc-1", kind: "significant_change", occurredAt: "2026-08-11T12:00:00.250Z", endedAt: null, latitude: 51.5, longitude: -0.1,
        horizontalAccuracyMeters: 40, speedMetersPerSecond: 12.5, metadata: { nativeCallbackAt: "2026-08-11T12:00:03.125Z" } },
      { id: "slc-2", kind: "significant_change", occurredAt: "2026-08-11T12:05:00.000Z", endedAt: null, latitude: 51.5, longitude: -0.1,
        horizontalAccuracyMeters: 40, speedMetersPerSecond: -1, metadata: { nativeCallbackAt: "not a time" } },
      { id: "slc-legacy", kind: "significant_change", occurredAt: "2026-08-11T12:10:00Z", endedAt: null, latitude: 51.5, longitude: -0.1,
        horizontalAccuracyMeters: 40, metadata: {} }
    ]);
    mocks.persistLocationEvidence.mockClear();
    expect((await drainNativeLocationSignalsInBatches()).transferredCount).toBe(3);
    const persisted = mocks.persistLocationEvidence.mock.calls.flatMap(([items]) => items as Array<Record<string, unknown> & { metadata: Record<string, unknown> }>);
    const byId = new Map(persisted.map(item => [item.clientEvidenceId, item]));
    expect(byId.get("slc-1")).toMatchObject({ occurredAt: "2026-08-11T12:00:00.250Z", speedMetersPerSecond: 12.5, metadata: { nativeCallbackAt: "2026-08-11T12:00:03.125Z" } });
    expect(byId.get("slc-1")?.receivedAt).not.toBe("2026-08-11T12:00:03.125Z");
    expect(byId.get("slc-2")).toMatchObject({ speedMetersPerSecond: null });
    expect(byId.get("slc-2")?.metadata).not.toHaveProperty("nativeCallbackAt");
    expect(byId.get("slc-legacy")).toMatchObject({ speedMetersPerSecond: null });
    expect(byId.get("slc-legacy")?.metadata).not.toHaveProperty("nativeCallbackAt");
  });
  it("a fresh Visit departure at any place starts an accuracy burst; one drained long after it doesn't (card K)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-08-11T12:20:00Z"));
    try {
      await configureLocationIntelligence(bootstrap());
      const visit = (id: string, endedAt: string | null) => ({ id, kind: "visit" as const, occurredAt: "2026-08-11T11:00:00.000Z", endedAt,
        latitude: 51.5, longitude: -0.1, horizontalAccuracyMeters: 30, metadata: endedAt ? {} : { visitDepartureOpen: "true" } });
      burstMocks.maybeStartAccuracyBurst.mockClear();
      mocks.drainSignals.mockResolvedValueOnce([visit("visit-left", "2026-08-11T12:15:00.000Z")]);
      mocks.persistLocationEvidence.mockResolvedValueOnce({ insertedCount: 1, admittedIds: ["visit-left"] } as never);
      await drainNativeLocationSignalsInBatches();
      expect(burstMocks.maybeStartAccuracyBurst).toHaveBeenCalledWith("departure", expect.anything(), "visit");
      burstMocks.maybeStartAccuracyBurst.mockClear();
      mocks.drainSignals.mockResolvedValueOnce([visit("visit-old", "2026-08-11T11:50:00.000Z")]);
      mocks.persistLocationEvidence.mockResolvedValueOnce({ insertedCount: 1, admittedIds: ["visit-old"] } as never);
      await drainNativeLocationSignalsInBatches();
      expect(burstMocks.maybeStartAccuracyBurst).not.toHaveBeenCalled();
      // A Visit not admitted (another owner's, or before the binding) starts nothing.
      mocks.drainSignals.mockResolvedValueOnce([visit("visit-other", "2026-08-11T12:18:00.000Z")]);
      mocks.persistLocationEvidence.mockResolvedValueOnce({ insertedCount: 0, admittedIds: [] } as never);
      await drainNativeLocationSignalsInBatches();
      expect(burstMocks.maybeStartAccuracyBurst).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("records Motion & Fitness history after the native drain, from the binding's cursor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-08-11T09:00:00Z"));
    try {
      await configureLocationIntelligence(bootstrap());
      const boundAt = Date.parse("2026-08-11T00:00:00Z");
      expect(mocks.queryActivities).toHaveBeenCalledWith(boundAt, Date.now(), 2_000);
      mocks.queryActivities.mockClear(); mocks.persistLocationEvidence.mockClear();
      const at = (minute: number) => Date.parse("2026-08-11T08:00:00Z") + minute * 60_000;
      mocks.queryActivities.mockResolvedValue([
        { startMs: at(0), stationary: true, walking: false, running: false, cycling: false, automotive: false, unknown: false, confidence: "high" },
        { startMs: at(5), stationary: true, walking: false, running: false, cycling: false, automotive: true, unknown: false, confidence: "high" },
        { startMs: at(20), stationary: true, walking: false, running: false, cycling: false, automotive: false, unknown: false, confidence: "medium" }
      ]);
      await drainNativeLocationSignalsInBatches();
      const [evidence, , options] = mocks.persistLocationEvidence.mock.calls.at(-1) as unknown as
        [Array<{ kind: string; occurredAt: string; latitude: null; metadata: Record<string, unknown> }>, unknown, { motionCapture: { next: { cursor: { lastRecordStartMs: number } }; readFloorMs: number } }];
      expect(evidence.map((item) => [item.kind, item.occurredAt, item.latitude, item.metadata.motionActivity])).toEqual([
        ["motion_activity", new Date(at(0)).toISOString(), null, "stationary"],
        ["motion_activity", new Date(at(5)).toISOString(), null, "automotive"],
        ["motion_activity", new Date(at(20)).toISOString(), null, "stationary"]
      ]);
      // New records carry the query time as the history's coverage.
      expect(new Set(evidence.map((item) => (item as unknown as { receivedAt: string }).receivedAt))).toEqual(new Set([new Date(Date.now()).toISOString()]));
      expect(options.motionCapture.next.cursor.lastRecordStartMs).toBe(at(20));
      expect(options.motionCapture.readFloorMs).toBe(Date.parse("2026-08-11T00:00:00Z"));
    } finally { vi.useRealTimers(); }
  });

  it("does not query Motion & Fitness history without permission", async () => {
    mocks.motionStatus.mockReturnValue("denied");
    await configureLocationIntelligence(bootstrap());
    await drainNativeLocationSignalsInBatches();
    expect(mocks.queryActivities).not.toHaveBeenCalled();
  });

  it("never fails a drain when the Motion & Fitness query fails", async () => {
    await configureLocationIntelligence(bootstrap());
    mocks.queryActivities.mockRejectedValue(new Error("ERR_MOTION_QUERY_FAILED"));
    mocks.drainSignals.mockResolvedValueOnce([{ id: "signal-1", kind: "provider_status", occurredAt: "2026-08-11T12:00:00.000Z", endedAt: null, latitude: null, longitude: null, horizontalAccuracyMeters: null, metadata: {} }]);
    await expect(drainNativeLocationSignalsInBatches()).resolves.toMatchObject({ transferredCount: 1 });
    expect(mocks.recordMotionCaptureFailure).toHaveBeenCalledOnce();
  });

  it("forces the server replay on foreground without new signals, and never runs the local journal replay", async () => {
    await configureLocationIntelligence(bootstrap()); vi.clearAllMocks();
    await syncLocationIntelligenceOnForeground();
    expect(mocks.refreshLocalJournalReplayIfDue).not.toHaveBeenCalled();
    expect(mocks.syncLocationEvidence).toHaveBeenCalledWith({ forceReplay: true });
  });
  it("a failing local journal replay never blocks bootstrap or foreground sync (stability audit location-4)", async () => {
    mocks.refreshLocalJournalReplayIfDue.mockRejectedValue(new Error("synthetic replay failure"));
    try {
      await expect(configureLocationIntelligence(bootstrap())).resolves.toBeUndefined();
      expect(mocks.syncLocationEvidence).toHaveBeenCalledOnce();
      await expect(syncLocationIntelligenceOnForeground()).resolves.toMatchObject({ synced: true });
      expect(mocks.syncLocationEvidence).toHaveBeenLastCalledWith({ forceReplay: true });
    } finally { mocks.refreshLocalJournalReplayIfDue.mockResolvedValue([]); }
  });
  it("runs the local journal replay only for the diagnostics export, labelled location-replay", async () => {
    let release!: () => void;
    mocks.refreshLocalJournalReplayIfDue.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve([]); }));
    const run = refreshLocalJournalReplayForDiagnostics();
    expect(runningJsTasks().running).toContain("location-replay");
    release(); await run;
    expect(mocks.refreshLocalJournalReplayIfDue).toHaveBeenCalledOnce();
    expect(runningJsTasks().running).not.toContain("location-replay");
  });
});
