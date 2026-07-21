import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "../api";

const secureValues = vi.hoisted(() => new Map<string, string>());
const mocks = vi.hoisted(() => ({
  configureLocationAccount: vi.fn(),
  drainSignals: vi.fn(() => Promise.resolve([])),
  clearAllSignals: vi.fn(() => Promise.resolve(0)),
  stopMonitoring: vi.fn(() => Promise.resolve({ enabled: false })),
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

const { configureLocationIntelligence } = await import("./runtime");

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
});
