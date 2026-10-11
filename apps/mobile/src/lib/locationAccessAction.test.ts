import { describe, expect, it } from "vitest";
import { createLatestRead, locationAccessAction, locationAccessLabels, locationSuggestionsSwitchHint } from "./locationAccessAction";

describe("Settings › Location access action (UIA-111)", () => {
  it("puts iOS Settings before restart, refresh and enable", () => {
    const base = { needsIosSettings: false, captureNeedsRetry: false, monitoringAllowed: false };
    expect(locationAccessAction({ ...base, needsIosSettings: true, captureNeedsRetry: true, monitoringAllowed: true })).toBe("settings");
    expect(locationAccessAction({ ...base, captureNeedsRetry: true, monitoringAllowed: true })).toBe("restart");
    expect(locationAccessAction({ ...base, monitoringAllowed: true })).toBe("refresh");
    expect(locationAccessAction(base)).toBe("enable");
  });

  it("says the same thing on screen and to VoiceOver", () => {
    expect(locationAccessLabels("settings")).toEqual({ label: "Open Settings", accessibilityLabel: "Open iPhone Settings to allow location" });
    expect(locationAccessLabels("restart")).toEqual({ label: "Restart location", accessibilityLabel: "Restart location" });
    expect(locationAccessLabels("refresh").accessibilityLabel).toBe("Refresh location access");
    expect(locationAccessLabels("enable").accessibilityLabel).toBe("Enable location access");
  });

  it("promises iOS Settings from the switch only when turning it on", () => {
    expect(locationSuggestionsSwitchHint({ needsIosSettings: true, consentOn: false })).toMatch(/Opens iPhone Settings/);
    expect(locationSuggestionsSwitchHint({ needsIosSettings: true, consentOn: true })).toMatch(/Saves your choice/);
    expect(locationSuggestionsSwitchHint({ needsIosSettings: false, consentOn: false })).toMatch(/Saves your choice/);
  });

  it("lets only the newest read publish, and none after invalidate", () => {
    const reads = createLatestRead();
    const first = reads.begin();
    const second = reads.begin();
    expect(reads.isLatest(first)).toBe(false);
    expect(reads.isLatest(second)).toBe(true);
    reads.invalidate();
    expect(reads.isLatest(second)).toBe(false);
  });
});
