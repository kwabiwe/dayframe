import { describe, expect, it } from "vitest";
import { travelModeLabel } from "./travelModePresentation";

describe("travel mode labels", () => {
  it("names each mode in user language and ignores anything else", () => {
    expect(["automotive", "cycling", "running", "walking"].map(travelModeLabel)).toEqual(["By car", "By bike", "Running", "On foot"]);
    for (const value of [null, undefined, "", "stationary", "unknown", "toString", 3]) expect(travelModeLabel(value)).toBeNull();
  });
});
