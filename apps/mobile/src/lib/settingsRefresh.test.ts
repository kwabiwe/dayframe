import { describe, expect, it } from "vitest";
import {
  isFreshSettingsSnapshot,
  shouldRefreshSettingsSnapshot,
  shouldShowSettingsRefreshSpinner
} from "./settingsRefresh";

describe("settings refresh behaviour", () => {
  it("keeps route and focus refreshes silent", () => {
    expect(shouldShowSettingsRefreshSpinner("navigation")).toBe(false);
    expect(shouldShowSettingsRefreshSpinner("focus")).toBe(false);
    expect(shouldShowSettingsRefreshSpinner("pull")).toBe(true);
  });

  it("reuses recent settings snapshots", () => {
    expect(isFreshSettingsSnapshot(1_000, 20_000, 30_000)).toBe(true);
    expect(shouldRefreshSettingsSnapshot(1_000, 20_000, 30_000)).toBe(false);
  });

  it("refreshes missing or stale settings snapshots", () => {
    expect(shouldRefreshSettingsSnapshot(null, 20_000, 30_000)).toBe(true);
    expect(shouldRefreshSettingsSnapshot(1_000, 40_001, 30_000)).toBe(true);
  });
});

describe("settingsGeofenceKey (I1)", () => {
  const place = { id: "p1", latitude: 1, longitude: 2, radiusMeters: 100, priority: 0, loggingEnabled: true, role: null };
  it("is stable for the same places and changes when a monitored field changes", async () => {
    const { settingsGeofenceKey } = await import("./settingsRefresh");
    expect(settingsGeofenceKey("u", "w", [place])).toBe(settingsGeofenceKey("u", "w", [{ ...place }]));
    expect(settingsGeofenceKey("u", "w", [place])).not.toBe(settingsGeofenceKey("u", "w", [{ ...place, radiusMeters: 200 }]));
    expect(settingsGeofenceKey("u", "w", [place])).not.toBe(settingsGeofenceKey("u2", "w", [place]));
  });
});
