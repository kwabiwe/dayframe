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
  processPendingLocationEvidence: vi.fn(async () => []),
  recordLocationStoreError: vi.fn(async () => undefined),
  recordLocationCaptureCleanupFailure: vi.fn(async () => undefined),
  syncLocationEvidence: vi.fn(async () => ({ synced: true, acknowledgedCount: 0 }))
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
vi.mock("../geofence", () => ({
  migrateLegacyLocationOptIn: async () => undefined,
  getLocationLearningEnabled: async () => true,
  stopLocationLearningIfStarted: async () => undefined,
  stopGeofencesIfStarted: async () => undefined,
  clearLocationCaptureCaches: async () => undefined
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
  persistLocationEvidence: async (items: unknown[]) => ({ insertedCount: items.length }),
  processPendingLocationEvidence: mocks.processPendingLocationEvidence,
  recordLocationStoreError: mocks.recordLocationStoreError,
  recordLocationCaptureCleanupFailure: mocks.recordLocationCaptureCleanupFailure,
  recordLocationCaptureDiscard: async () => undefined,
  syncLocationEvidence: mocks.syncLocationEvidence
}));
vi.mock("../../../modules/dayframe-location-visits", () => ({
  clearAllSignals: mocks.clearAllSignals,
  clearSignals: vi.fn(),
  drainSignals: mocks.drainSignals,
  getStatus: vi.fn(),
  startMonitoring: vi.fn(),
  stopMonitoring: mocks.stopMonitoring
}));
const { configureLocationIntelligence, drainNativeLocationSignalsInBatches, syncLocationIntelligenceOnForeground } = await import("./runtime");
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
    expect(mocks.processPendingLocationEvidence).toHaveBeenCalledTimes(2);
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
  it("reprocesses current time and forces replay on foreground without new signals", async () => {
    await configureLocationIntelligence(bootstrap()); vi.clearAllMocks();
    await syncLocationIntelligenceOnForeground();
    expect(mocks.processPendingLocationEvidence).toHaveBeenCalledOnce();
    expect(mocks.syncLocationEvidence).toHaveBeenCalledWith({ forceReplay: true });
  });
});
