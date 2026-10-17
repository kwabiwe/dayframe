import { describe, expect, it, vi } from "vitest";
import type { LocationSegment } from "@dayframe/shared";
import { withCorrectedStayPlaces } from "./location-review-semantic-batch";

const ids = { workspaceId: "00000000-0000-4000-8000-000000000010", userId: "00000000-0000-4000-8000-000000000001" };
const session = ids as never;
const stay = (clientSegmentId: string, placeId: string | null) => ({ kind: "stay", clientSegmentId, placeId, learnedPlaceId: null,
  placeMatchKind: placeId ? "saved" : "unknown" }) as unknown as LocationSegment;
const move = (clientSegmentId: string, from: string, to: string, fromPlaceId: string | null, toPlaceId: string | null) => ({
  kind: "commute", clientSegmentId, fromStaySegmentId: from, toStaySegmentId: to, fromPlaceId, toPlaceId }) as unknown as LocationSegment;

describe("withCorrectedStayPlaces (Codex r1/r2 on #459)", () => {
  it("keeps a corrected Stay's place and activity, and ends its Moves at that place", async () => {
    const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows: [
      { id: "db-visit", placeId: "place-pool", learnedPlaceId: null, kind: "saved", hasCategory: true, categoryId: "cat-own" },
      { id: "db-home", placeId: null, learnedPlaceId: null, kind: "unknown", hasCategory: false, categoryId: null }
    ] }));
    const stayIds = new Map([["visit", "db-visit"], ["home", "db-home"], ["work", "db-work"]]);
    const result = await withCorrectedStayPlaces({ query } as never, session, [
      stay("visit", null), stay("home", "place-home"), stay("work", "place-work"),
      move("there", "home", "visit", "place-home", null), move("onward", "visit", "work", null, "place-work")
    ], stayIds);
    expect(query.mock.calls[0][1]).toEqual([ids.workspaceId, ids.userId, ["db-home", "db-visit", "db-work"]]);
    const [visit, home, work, there, onward] = result.segments as Array<Record<string, unknown>>;
    expect(visit).toMatchObject({ placeId: "place-pool", placeMatchKind: "saved" });
    // A Stay corrected to no place loses its place, and its Move's end with it.
    expect(home).toMatchObject({ placeId: null, placeMatchKind: "unknown" });
    expect(work).toMatchObject({ placeId: "place-work", placeMatchKind: "saved" });
    expect(there).toMatchObject({ fromPlaceId: null, toPlaceId: "place-pool" });
    expect(onward).toMatchObject({ fromPlaceId: "place-pool", toPlaceId: "place-work" });
    expect([...result.correctedCategories]).toEqual([["visit", "cat-own"]]);
  });

  it("changes nothing without a corrected Stay", async () => {
    const segments = [stay("visit", null)];
    const result = await withCorrectedStayPlaces({ query: vi.fn(async () => ({ rows: [] })) } as never, session, segments, new Map([["visit", "db-visit"]]));
    expect(result.segments).toBe(segments);
    expect(result.correctedCategories.size).toBe(0);
  });
});
