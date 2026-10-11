import { describe, expect, it, vi } from "vitest";

vi.mock("./reviewSyncStore", () => ({
  mobileReviewItemFromPresentation: (record: { reviewItemId: string; title: string }) => ({ id: record.reviewItemId, title: record.title, status: "open" })
}));

const { BOOTSTRAP_REVIEW_ITEM_CAP, bootstrapReviewListMayBeIncomplete, calendarReviewItems, scopedOpenReviewItems } = await import("./calendarScopedReview");

const record = (id: string, status = "open", canonicalEntryIds: string[] = []) => ({ kind: "review", reviewItemId: id, title: id, status, canonicalEntryIds });

describe("Calendar's scoped Review items (UIA-060)", () => {
  it("takes open suggestions from the scoped snapshot, less ones decided on this iPhone", () => {
    const snapshot = {
      response: { records: [record("a"), record("b", "accepted"), record("c")], lookup: { reviewItems: [record("d")] } },
      effects: [{ reviewItemId: "c", localEffect: "hidden" }]
    } as never;
    expect(scopedOpenReviewItems(snapshot).map((item) => item.id)).toEqual(["a", "d"]);
    expect(scopedOpenReviewItems(null)).toEqual([]);
  });

  it("adds them only when the bootstrap list is at its cap, and the bootstrap's own items win", () => {
    const item = (id: string) => ({ id, title: `bootstrap ${id}` }) as never;
    const short = [item("x")];
    expect(calendarReviewItems(short, [item("y")])).toEqual(short);
    const full = Array.from({ length: BOOTSTRAP_REVIEW_ITEM_CAP }, (_, index) => item(`b${index}`));
    const merged = calendarReviewItems(full, [item("b1"), item("older")]);
    expect(merged).toHaveLength(BOOTSTRAP_REVIEW_ITEM_CAP + 1);
    expect(merged.at(-1)).toMatchObject({ id: "older" });
    expect(merged.find((entry) => entry.id === "b1")).toMatchObject({ title: "bootstrap b1" });
  });

  it("keeps the snapshot's linkage, so a suggestion and its needs-review entry draw once (Codex r6)", () => {
    const snapshot = {
      response: {
        records: [record("a"), { kind: "legacy_review_entry", entryId: "entry-legacy", linkedReviewItemId: "a" }, record("b", "open", ["entry-canonical"])],
        links: [{ reviewItemId: "a", entryIds: ["entry-link"], status: "open" }],
        lookup: { reviewItems: [] }
      },
      effects: []
    } as never;
    const items = scopedOpenReviewItems(snapshot);
    expect(items.find((item) => item.id === "a")?.linkedEntryIds?.sort()).toEqual(["entry-legacy", "entry-link"]);
    expect(items.find((item) => item.id === "b")?.linkedEntryIds).toEqual(["entry-canonical"]);
  });

  it("treats a list shorter than the cap as incomplete when the server counts more open (Codex r6)", () => {
    expect(bootstrapReviewListMayBeIncomplete({ reviewItems: new Array(99), stats: { reviewCount: 140 } })).toBe(true);
    expect(bootstrapReviewListMayBeIncomplete({ reviewItems: new Array(99), stats: { reviewCount: 99 } })).toBe(false);
    expect(bootstrapReviewListMayBeIncomplete({ reviewItems: new Array(BOOTSTRAP_REVIEW_ITEM_CAP) })).toBe(true);
    expect(bootstrapReviewListMayBeIncomplete(null)).toBe(false);
    const item = (id: string) => ({ id }) as never;
    expect(calendarReviewItems([item("x")], [item("y")], true).map((entry) => (entry as { id: string }).id)).toEqual(["x", "y"]);
  });
});
