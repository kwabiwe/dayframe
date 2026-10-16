import { describe, expect, it, vi } from "vitest";
import { segmentMoveName } from "./location-review-semantic-batch";

const session = { workspaceId: "workspace-private", userId: "user-private", authMode: "provider" as const, scopes: [] };
const segment = (patch: Record<string, unknown>) => ({
  kind: "commute", clientSegmentId: "move-1", fromPlaceId: null, toPlaceId: null,
  fromStaySegmentId: "stay-from", toStaySegmentId: "stay-to", qualificationReason: "significant_endpoint_displacement", ...patch
}) as never;
const places = (rows: Array<{ id: string; name: string; role: string | null }>) => vi.fn(async (sql: string, values?: unknown[]) => ({
  rows: sql.includes("from places pl") ? rows.filter((row) => (values?.[1] as string[]).includes(row.id)) : []
}));

describe("Move names from their ends (PRD D19)", () => {
  it("calls Home ↔ Work a Commute, in either direction, with the mode on the route line", async () => {
    const query = places([{ id: "home", name: "Home", role: "home" }, { id: "work", name: "Work", role: "work" }]);
    expect(await segmentMoveName({ query } as never, session, segment({ fromPlaceId: "home", toPlaceId: "work", travelMode: "automotive" }), new Map()))
      .toEqual({ title: "Commute", route: "Drive · Home → Work", activity: "commute" });
    expect((await segmentMoveName({ query } as never, session, segment({ fromPlaceId: "work", toPlaceId: "home" }), new Map())).title).toBe("Commute");
  });

  it("calls any other Move by its mode, else Trip, with Travel as its activity", async () => {
    const query = places([{ id: "home", name: "Home", role: "home" }, { id: "gym", name: "Peak Gym", role: null }]);
    expect(await segmentMoveName({ query } as never, session, segment({ fromPlaceId: "home", toPlaceId: "gym", travelMode: "walking" }), new Map()))
      .toEqual({ title: "Walk", route: "Home → Peak Gym", activity: "travel" });
    expect((await segmentMoveName({ query } as never, session, segment({ fromPlaceId: "home", toPlaceId: "gym" }), new Map())).title).toBe("Trip");
  });

  it("names a round trip and time away from where they started, and a Move with a stop as an errand", async () => {
    const query = places([{ id: "home", name: "Home", role: "home" }]);
    expect(await segmentMoveName({ query } as never, session, segment({ fromPlaceId: "home", toPlaceId: "home",
      qualificationReason: "same_place_outing", travelMode: "automotive" }), new Map()))
      .toEqual({ title: "Drive", route: "Round trip from Home", activity: "travel" });
    expect(await segmentMoveName({ query } as never, session, segment({ fromPlaceId: "home", toPlaceId: "home",
      qualificationReason: "same_place_outing", stops: [{}] }), new Map()))
      .toEqual({ title: "Trip", route: "Home → a stop → Home", activity: "errand" });
  });

  it("names a learned end through its persisted stay, and an end it cannot name as Unknown place", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => ({
      rows: sql.includes("join learned_places") && (values?.[2] as string[]).includes("db-from") ? [{ id: "db-from", name: "Library", role: null }] : []
    }));
    expect((await segmentMoveName({ query } as never, session, segment({}), new Map([["stay-from", "db-from"]]))).route)
      .toBe("Library → Unknown place");
  });
});
