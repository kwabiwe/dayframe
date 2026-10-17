import { describe, expect, it } from "vitest";
import { persistedStayKey } from "./name-patterns";

const centre = { latitude: 0.001, longitude: 0.002 };

describe("persistedStayKey (learned names, Codex r3 on #458)", () => {
  it("keys a corrected saved or learned visit by that place", () => {
    expect(persistedStayKey({ placeId: "p1", learnedPlaceId: null, placeMatchKind: "saved", ...centre })).toBe("p:p1");
    expect(persistedStayKey({ placeId: "p1", learnedPlaceId: "l1", placeMatchKind: "learned", ...centre })).toBe("l:l1");
  });

  it("keys a correction part by the learned place it kept, else its saved place, else its cell", () => {
    expect(persistedStayKey({ placeId: "p1", learnedPlaceId: "l1", placeMatchKind: "manual", ...centre })).toBe("l:l1");
    expect(persistedStayKey({ placeId: "p1", learnedPlaceId: null, placeMatchKind: "manual", ...centre })).toBe("p:p1");
    expect(persistedStayKey({ placeId: null, learnedPlaceId: null, placeMatchKind: "manual", ...centre })).toMatch(/^c:/);
    expect(persistedStayKey({ placeId: null, learnedPlaceId: null, placeMatchKind: null, latitude: null, longitude: null })).toBeNull();
  });
});
