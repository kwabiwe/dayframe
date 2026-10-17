import { describe, expect, it } from "vitest";
import { locationCellKey, movePatternKey, nameBand, stayPatternKey } from "../src/location/namePatterns";

describe("learned-name patterns (PRD D19, A8)", () => {
  it("bands an item by its local start: weekend, morning, afternoon, evening", () => {
    expect(nameBand("2026-10-17T08:30:00Z", "Europe/London")).toBe("weekend");
    expect(nameBand("2026-10-16T07:30:00Z", "Europe/London")).toBe("morning");
    expect(nameBand("2026-10-16T14:00:00Z", "Europe/London")).toBe("afternoon");
    expect(nameBand("2026-10-16T19:00:00Z", "Europe/London")).toBe("evening");
    expect(nameBand("2026-10-16T02:30:00Z", "Europe/London")).toBe("evening");
    expect(nameBand("2026-10-16T14:00:00Z", "Not/AZone")).toBe("afternoon");
  });

  it("puts nearby points in one 150 m cell and far ones in different cells", () => {
    expect(locationCellKey(0.0001, 0.0001)).toBe(locationCellKey(0.0002, 0.0002));
    expect(locationCellKey(0, 0)).not.toBe(locationCellKey(0.01, 0));
    expect(locationCellKey(51.5, -0.12)).toMatch(/^-?\d+\.-?\d+$/);
  });

  it("keys a Stay by its place, learned place or cell", () => {
    expect(stayPatternKey({ placeId: "a", learnedPlaceId: "b" })).toBe("p:a");
    expect(stayPatternKey({ learnedPlaceId: "b" })).toBe("l:b");
    expect(stayPatternKey({ centreLatitude: 0, centreLongitude: 0 })).toBe(`c:${locationCellKey(0, 0)}`);
    expect(stayPatternKey({})).toBeNull();
  });

  it("keys a Move by its ends and mode, and a round trip by its origin, turnaround and mode", () => {
    expect(movePatternKey({ fromKey: "p:a", toKey: "p:b", travelMode: "walking", roundTrip: false })).toBe("m:p:a>p:b:walking");
    expect(movePatternKey({ fromKey: "p:a", toKey: "p:b", roundTrip: false })).toBe("m:p:a>p:b:any");
    expect(movePatternKey({ fromKey: "p:a", toKey: "p:a", travelMode: "automotive", roundTrip: true, turnaroundCell: "1.2" })).toBe("r:p:a:1.2:automotive");
    expect(movePatternKey({ fromKey: null, toKey: "p:b", roundTrip: false })).toBeNull();
  });
});
