import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const reviewScreen = readFileSync(resolve(__dirname, "../../app/review.tsx"), "utf8");

describe("Review backlog paging contract", () => {
  it("uses a bounded backlog page and exposes the next page as an accessible action", () => {
    expect(reviewScreen).toContain("fetchReviewPresentationPage");
    expect(reviewScreen).toContain('mode: "backlog"');
    expect(reviewScreen).toContain("mergeReviewBacklogPage");
    expect(reviewScreen).toContain("Load more Review items");
    expect(reviewScreen).toContain("Review changed while more items were loading");
  });
});
