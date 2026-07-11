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
