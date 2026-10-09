import { describe, expect, it } from "vitest";
import { createReviewKnownItems, reviewDataOwnerKey } from "./reviewKnownItems";

const accountA = { workspace: { id: "wA" }, user: { id: "uA" } };
const accountB = { workspace: { id: "wB" }, user: { id: "uB" } };

describe("review known items", () => {
  it("reads an item back only for the account it was shown for", () => {
    const known = createReviewKnownItems<{ id: string }>();
    known.remember({ id: "a" }, reviewDataOwnerKey(accountA));
    expect(known.get("a", accountA)).toEqual({ id: "a" });
    expect(known.get("a", accountB)).toBeUndefined();
    expect(known.get("a", null)).toBeUndefined();
  });

  it("never hands the old account's card to the new one when a late effect re-remembers it", () => {
    const known = createReviewKnownItems<{ id: string }>();
    // B's data arrives and clears the store; A's passive effect then runs late with A's items.
    known.clear();
    known.remember({ id: "old" }, reviewDataOwnerKey(accountA));
    expect(known.get("old", accountB)).toBeUndefined();
  });

  it("tells workspaces and users apart", () => {
    expect(reviewDataOwnerKey(accountA)).not.toBe(reviewDataOwnerKey({ workspace: { id: "wA" }, user: { id: "uB" } }));
  });
});
