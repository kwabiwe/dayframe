import { describe, expect, it } from "vitest";
import { blocksNavOrigin, evidenceBackLabel, previousRouteBackLabel, settingsBackLabel, settingsSectionTitle } from "./blocksNav";

describe("Blocks nav back labels", () => {
  it("names the screen the back button returns to", () => {
    expect(settingsBackLabel("index", null)).toBe("Today");
    expect(settingsBackLabel("sync", null)).toBe("Settings");
    expect(settingsBackLabel("sync", "today")).toBe("Today");
    expect(settingsBackLabel("sync", "review")).toBe("Review");
    expect(settingsBackLabel("index", "calendar")).toBe("Calendar");
    expect(settingsBackLabel("sync", "reports")).toBe("Reports");
    expect(evidenceBackLabel(null)).toBe("Review");
    expect(evidenceBackLabel("today")).toBe("Today");
  });

  it("ignores unknown or repeated origin params", () => {
    expect(blocksNavOrigin(undefined)).toBeNull();
    expect(blocksNavOrigin("elsewhere")).toBeNull();
    expect(blocksNavOrigin("toString")).toBeNull();
    expect(blocksNavOrigin(["review", "today"])).toBe("review");
  });
});

describe("back label from the navigation stack", () => {
  const tabs = (tab: string) => ({ key: "tabs", name: "(tabs)", state: { index: 0, routes: [{ name: tab }] } });

  it("names the tab under Review, so Calendar's hatched suggestion returns 'Back to Calendar'", () => {
    const routes = [tabs("calendar"), { key: "r", name: "review" }];
    expect(previousRouteBackLabel(routes, "r")).toBe("Calendar");
    expect(previousRouteBackLabel([tabs("today"), { key: "r", name: "review" }], "r")).toBe("Today");
  });

  it("names the Settings section under Saved places (Settings or Location)", () => {
    const fromLocation = [tabs("today"), { key: "s1", name: "settings" }, { key: "s2", name: "settings", params: { section: "automations" } }, { key: "p", name: "places" }];
    expect(previousRouteBackLabel(fromLocation, "p")).toBe("Location");
    const fromIndex = [tabs("today"), { key: "s1", name: "settings" }, { key: "p", name: "places" }];
    expect(previousRouteBackLabel(fromIndex, "p")).toBe("Settings");
  });

  it("names Reports, Review and Location evidence, and gives up on routes it can't name", () => {
    expect(previousRouteBackLabel([tabs("reports"), { key: "s", name: "settings" }], "s")).toBe("Reports");
    expect(previousRouteBackLabel([{ key: "r", name: "review" }, { key: "s", name: "settings", params: { section: "sync" } }], "s")).toBe("Review");
    expect(previousRouteBackLabel([{ key: "e", name: "review/[id]" }, { key: "s", name: "settings" }], "s")).toBe("Location evidence");
    expect(previousRouteBackLabel([{ key: "o", name: "onboarding" }, { key: "s", name: "settings" }], "s")).toBeNull();
    expect(previousRouteBackLabel([{ key: "s", name: "settings" }], "s")).toBeNull();
    expect(previousRouteBackLabel(undefined, "s")).toBeNull();
    expect(settingsSectionTitle("toString")).toBe("Settings");
  });
});
