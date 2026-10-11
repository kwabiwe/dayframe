import { describe, expect, it, vi } from "vitest";

vi.mock("./reviewSyncStore", () => ({
  mobileReviewItemFromPresentation: (record: { reviewItemId: string; title: string }) => ({ id: record.reviewItemId, title: record.title, status: "open" })
}));

const { BOOTSTRAP_REVIEW_ITEM_CAP, calendarReviewItems, scopedOpenReviewItems } = await import("./calendarScopedReview");

const record = (id: string, status = "open") => ({ kind: "review", reviewItemId: id, title: id, status });

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
});
