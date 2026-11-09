import { describe, expect, it } from "vitest";
import { backActionLabel, blocksNavOrigin, previousRouteBackLabel, settingsBackLabel, settingsSectionTitle } from "./blocksNav";

describe("Blocks nav back labels", () => {
  it("names the screen the back button returns to", () => {
    expect(settingsBackLabel("index", null)).toBe("Today");
    expect(settingsBackLabel("sync", null)).toBe("Settings");
    expect(settingsBackLabel("sync", "today")).toBe("Today");
    expect(settingsBackLabel("index", "calendar")).toBe("Calendar");
    expect(settingsBackLabel("sync", "reports")).toBe("Reports");
  });

  it("ignores unknown or repeated origin params, and Review is no origin any more (step 15)", () => {
    expect(blocksNavOrigin(undefined)).toBeNull();
    expect(blocksNavOrigin("elsewhere")).toBeNull();
    expect(blocksNavOrigin("toString")).toBeNull();
    expect(blocksNavOrigin("review")).toBeNull();
    expect(blocksNavOrigin(["today", "calendar"])).toBe("today");
  });
});

describe("back label from the navigation stack", () => {
  const tabs = (tab: string) => ({ key: "tabs", name: "(tabs)", state: { index: 0, routes: [{ name: tab }] } });

  it("names the tab under Settings, so the Calendar avatar's Settings returns 'Back to Calendar'", () => {
    expect(previousRouteBackLabel([tabs("calendar"), { key: "s", name: "settings" }], "s")).toBe("Calendar");
    expect(previousRouteBackLabel([tabs("today"), { key: "s", name: "settings" }], "s")).toBe("Today");
  });

  it("names the Settings section under Saved places (Settings or Location)", () => {
    const fromLocation = [tabs("today"), { key: "s1", name: "settings" }, { key: "s2", name: "settings", params: { section: "automations" } }, { key: "p", name: "places" }];
    expect(previousRouteBackLabel(fromLocation, "p")).toBe("Location");
    const fromIndex = [tabs("today"), { key: "s1", name: "settings" }, { key: "p", name: "places" }];
    expect(previousRouteBackLabel(fromIndex, "p")).toBe("Settings");
  });

  it("names Reports, and gives up on routes it can't name", () => {
    expect(previousRouteBackLabel([tabs("reports"), { key: "s", name: "settings" }], "s")).toBe("Reports");
    // A screen below that can't be named gives a plain "Back", never a wrong name.
    expect(previousRouteBackLabel([{ key: "o", name: "onboarding" }, { key: "s", name: "settings" }], "s")).toBe("Back");
    expect(previousRouteBackLabel([tabs("today"), { key: "e", name: "place-editor" }, { key: "s", name: "settings" }], "s")).toBe("Back");
    // The removed Review screens are never named (step 15).
    expect(previousRouteBackLabel([{ key: "r", name: "review" }, { key: "s", name: "settings" }], "s")).toBe("Back");
    expect(backActionLabel("Back")).toBe("Back");
    expect(backActionLabel("Calendar")).toBe("Back to Calendar");
    expect(previousRouteBackLabel([{ key: "s", name: "settings" }], "s")).toBeNull();
    expect(previousRouteBackLabel(undefined, "s")).toBeNull();
    expect(settingsSectionTitle("toString")).toBe("Settings");
  });
});
