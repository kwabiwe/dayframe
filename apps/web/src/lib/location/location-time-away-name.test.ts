import { describe, expect, it, vi } from "vitest";
import { timeAwayPlaceName } from "./location-review-semantic-batch";

const session = { workspaceId: "workspace-private", userId: "user-private", authMode: "provider" as const, scopes: [] };
const segment = (fromPlaceId: string | null) => ({ kind: "commute", fromPlaceId, fromStaySegmentId: "stay-origin",
  qualificationReason: "same_place_outing" }) as never;

describe("time away place name", () => {
  it("names a saved place", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("from places") ? [{ name: "Home" }] : [] }));
    expect(await timeAwayPlaceName({ query } as never, session, segment("place-1"), new Map())).toBe("Home");
  });

  it("names an accepted learned place through the origin stay (review finding 6)", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => ({
      rows: sql.includes("join learned_places") && values?.[0] === "db-origin" ? [{ name: "Library" }] : []
    }));
    expect(await timeAwayPlaceName({ query } as never, session, segment(null), new Map([["stay-origin", "db-origin"]]))).toBe("Library");
    expect(await timeAwayPlaceName({ query } as never, session, segment(null), new Map())).toBeNull();
  });
});
