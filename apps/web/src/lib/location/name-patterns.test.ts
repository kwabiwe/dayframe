import { describe, expect, it, vi } from "vitest";
import type { LocationSegment } from "@dayframe/shared";
import { namePatternsFor, persistedStayKey } from "./name-patterns";

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

describe("namePatternsFor with corrected Move ends (Codex r4 on #459)", () => {
  const session = { workspaceId: "00000000-0000-4000-8000-000000000010", userId: "00000000-0000-4000-8000-000000000001" } as never;
  const query = vi.fn(async (sql: string) => sql.includes("continuity_status = 'manual'") || !sql.includes("from stay_segments")
    ? { rows: [] }
    : { rows: [
      { id: "db-home", placeId: "place-home", learnedPlaceId: null, latitude: 0, longitude: 0 },
      { id: "db-work", placeId: "place-work", learnedPlaceId: null, latitude: 0.01, longitude: 0 }
    ] });
  const move = (clientSegmentId: string, qualificationReason: string) => ({
    kind: "commute", clientSegmentId, fromStaySegmentId: "home", toStaySegmentId: "work", fromPlaceId: "place-home", toPlaceId: "place-work",
    qualificationReason, travelMode: "automotive", startedAt: "2026-10-16T07:00:00.000Z", stoppedAt: "2026-10-16T07:20:00.000Z",
    evidenceIds: [], stops: []
  }) as unknown as LocationSegment;
  const stayIds = new Map([["home", "db-home"], ["work", "db-work"]]);

  it("keys a Move whose end was corrected to another place as that Move, not as the round trip it was", async () => {
    const candidates = [
      { clientEventId: "corrected", segment: move("corrected", "same_place_meaningful_round_trip") },
      { clientEventId: "genuine", segment: move("genuine", "significant_endpoint_displacement") }
    ];
    const patterns = await namePatternsFor({ query } as never, session, candidates, stayIds, new Map(), new Map(), new Set(["corrected"]));
    expect(patterns.get("corrected")?.key).toBe(patterns.get("genuine")?.key);
    const uncorrected = await namePatternsFor({ query } as never, session, candidates, stayIds, new Map(), new Map());
    expect(uncorrected.get("corrected")).toBeUndefined();
  });
});

