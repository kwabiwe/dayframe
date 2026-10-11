import { describe, expect, it } from "vitest";
import { blocksNavOrigin, evidenceBackLabel, settingsBackLabel } from "./blocksNav";

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
