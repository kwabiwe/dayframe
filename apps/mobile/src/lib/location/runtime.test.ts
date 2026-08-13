import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DayframeLocationNativeSignal } from "../../../modules/dayframe-location-visits";
import type { MobileBootstrap } from "../api";

const secureValues = vi.hoisted(() => new Map<string, string>());
const mocks = vi.hoisted(() => ({
  configureLocationAccount: vi.fn(),
  drainSignals: vi.fn<(limit: number) => Promise<DayframeLocationNativeSignal[]>>(() => Promise.resolve([])),
  clearAllSignals: vi.fn(() => Promise.resolve(0)),
  stopMonitoring: vi.fn(() => Promise.resolve({ enabled: false })),
  processPendingLocationEvidence: vi.fn(() => Promise.resolve([])),
  syncLocationEvidence: vi.fn(() => Promise.resolve({ synced: true, acknowledgedCount: 0 }))
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(secureValues.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    secureValues.set(key, value);
    return Promise.resolve();
  })
}));

vi.mock("./store", () => ({
  configureLocationAccount: mocks.configureLocationAccount,
  activeLocationCaptureContext: vi.fn(() => Promise.resolve({ deviceId: "ios-device", timeZone: "Europe/London" })),
  getLocationRolloutMode: vi.fn(() => Promise.resolve("v2_shadow")),
  persistLocationEvidence: vi.fn(),
  processPendingLocationEvidence: mocks.processPendingLocationEvidence,
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

const {
  configureLocationIntelligence,
  drainNativeLocationSignalsInBatches,
  syncLocationIntelligenceOnForeground
} = await import("./runtime");

function bootstrap(userId: string, workspaceId: string, mode: MobileBootstrap["locationRolloutMode"] = "v2_shadow") {
  return {
    user: { id: userId, email: `${userId}@example.test`, name: userId },
    workspace: { id: workspaceId, name: workspaceId },
    locationRolloutMode: mode,
    activeEntry: null,
    projects: [],
    categories: [],
    entries: [],
    places: [],
    reviewItems: []
  } satisfies MobileBootstrap;
}

describe("location account binding", () => {
  beforeEach(() => {
    secureValues.clear();
    vi.clearAllMocks();
    mocks.clearAllSignals.mockResolvedValue(0);
  });

  it("keeps the native journal for the same authenticated owner", async () => {
    await configureLocationIntelligence(bootstrap("user-a", "workspace-a"));
    await configureLocationIntelligence(bootstrap("user-a", "workspace-a"));
    expect(mocks.clearAllSignals).not.toHaveBeenCalled();
    expect(mocks.processPendingLocationEvidence).toHaveBeenCalledTimes(2);
  });

  it("purges native evidence before binding a different account", async () => {
    await configureLocationIntelligence(bootstrap("user-a", "workspace-a"));
    mocks.configureLocationAccount.mockClear();
    await configureLocationIntelligence(bootstrap("user-b", "workspace-a"));

    expect(mocks.clearAllSignals).toHaveBeenCalledOnce();
    expect(mocks.clearAllSignals.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.configureLocationAccount.mock.invocationCallOrder[0]);
  });

  it("fails closed when the prior native journal cannot be purged", async () => {
    await configureLocationIntelligence(bootstrap("user-a", "workspace-a"));
    mocks.configureLocationAccount.mockClear();
    mocks.clearAllSignals.mockRejectedValueOnce(new Error("native purge failed"));

    await expect(configureLocationIntelligence(bootstrap("user-b", "workspace-a")))
      .rejects.toThrow("native purge failed");
    expect(mocks.configureLocationAccount).not.toHaveBeenCalled();
  });

  it("stops capture and clears queued signals in server-controlled v1 mode", async () => {
    await configureLocationIntelligence(bootstrap("user-a", "workspace-a", "v1"));
    expect(mocks.stopMonitoring).toHaveBeenCalledOnce();
    expect(mocks.clearAllSignals).toHaveBeenCalledOnce();
    expect(mocks.drainSignals).not.toHaveBeenCalled();
  });

  it("keeps bootstrap reconciliation alive until the location outbox finishes", async () => {
    let finishSync: ((value: { synced: true; acknowledgedCount: number }) => void) | undefined;
    mocks.syncLocationEvidence.mockImplementationOnce(() => new Promise((resolve) => {
      finishSync = resolve;
    }));

    let configured = false;
    const configuration = configureLocationIntelligence(bootstrap("user-a", "workspace-a"))
      .then(() => { configured = true; });
    await vi.waitFor(() => expect(mocks.syncLocationEvidence).toHaveBeenCalledOnce());
    expect(configured).toBe(false);

    finishSync?.({ synced: true, acknowledgedCount: 0 });
    await configuration;
    expect(configured).toBe(true);
  });

  it("bounds native draining to five 100-item passes", async () => {
    mocks.drainSignals.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({
      id: `signal-${index}`,
      kind: "provider_status" as const,
      occurredAt: "2026-08-11T12:00:00.000Z",
      endedAt: null,
      latitude: null,
      longitude: null,
      horizontalAccuracyMeters: null,
      metadata: {}
    })));

    const result = await drainNativeLocationSignalsInBatches();

    expect(result.transferredCount).toBe(500);
    expect(mocks.drainSignals).toHaveBeenCalledTimes(5);
    expect(mocks.drainSignals).toHaveBeenCalledWith(100);
  });

  it("reprocesses local time and forces replay on foreground without new signals", async () => {
    await configureLocationIntelligence(bootstrap("user-a", "workspace-a"));
    vi.clearAllMocks();
    mocks.drainSignals.mockResolvedValue([]);

    await syncLocationIntelligenceOnForeground();

    expect(mocks.processPendingLocationEvidence).toHaveBeenCalledOnce();
    expect(mocks.syncLocationEvidence).toHaveBeenCalledWith({ forceReplay: true });
  });
});
