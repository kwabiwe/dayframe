import { describe, expect, it } from "vitest";
import { tagOutings } from "./location-review-semantic-batch";

const stay = (id: string, kind: "unknown" | "saved" = "unknown", status = "needs_review") =>
  ({ kind: "stay", review_status: status, raw_payload: { clientSegmentId: id, placeMatchKind: kind } as Record<string, unknown> });
const move = (from: string, to: string, extra: Record<string, unknown> = {}, status = "needs_review") =>
  ({ kind: "commute", review_status: status, raw_payload: { fromStaySegmentId: from, toStaySegmentId: to, ...extra } as Record<string, unknown> });
const tags = (row: { raw_payload: Record<string, unknown> }) => [row.raw_payload.outingKey ?? null, row.raw_payload.outingRole ?? null];

describe("one card per outing (PRD D19)", () => {
  it("joins an unknown Stay's card with the Move cards there and back", () => {
    const rows = [stay("home", "saved"), move("home", "shop"), stay("shop"), move("shop", "home2"), stay("home2", "saved")];
    tagOutings(rows);
    expect(rows.map(tags)).toEqual([[null, null], ["outing:shop", "in"], ["outing:shop", "stay"], ["outing:shop", "out"], [null, null]]);
  });

  it("gives a Move to the unknown Stay it arrives at: Home → A → B → Home is A with the Move there, B with the rest", () => {
    const rows = [move("home", "a"), stay("a"), move("a", "b"), stay("b"), move("b", "home2")];
    tagOutings(rows);
    expect(rows.map(tags)).toEqual([
      ["outing:a", "in"], ["outing:a", "stay"], ["outing:b", "in"], ["outing:b", "stay"], ["outing:b", "out"]
    ]);
  });

  it("leaves decided cards, saved places, time away and lone Stays alone", () => {
    const rows = [
      move("home", "x", {}, "confirmed"), stay("x"),
      move("home", "gym"), stay("gym", "saved"),
      move("home", "home2", { stopCount: 1 }), stay("lonely")
    ];
    tagOutings(rows);
    expect(rows.map(tags)).toEqual([[null, null], [null, null], [null, null], [null, null], [null, null], [null, null]]);
  });
});
