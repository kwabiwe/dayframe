import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const reviewScreen = readFileSync(resolve(__dirname, "../../app/review.tsx"), "utf8");

describe("Review backlog paging contract", () => {
  it("keeps failed reads in diagnostics while preserving the mounted page and retry action", () => {
    expect(reviewScreen).not.toContain("Connect to load more Review items.");
    expect(reviewScreen).not.toContain("Couldn’t load more Review items. Try again.");
    expect(reviewScreen).not.toContain("if (options.reset) commitReviewBacklog(null)");
    expect(reviewScreen).toContain('recordReviewPresentationRead(owner, "backlog",');
    expect(reviewScreen).toContain("onPress={loadMoreReviewBacklog}");
    const settings = readFileSync(resolve(__dirname, "../../app/settings.tsx"), "utf8");
    expect(settings).toContain("reviewSyncDiagnostics?.presentationReads?.map");
    expect(settings).toContain("{read.status}");
    expect(settings).toContain("formatQueueTime(read.checkedAt)");
  });
  it("uses a bounded backlog page and exposes the next page as an accessible action", () => {
    expect(reviewScreen).toContain("fetchReviewPresentationPage");
    expect(reviewScreen).toContain('mode: "backlog"');
    expect(reviewScreen).toContain("mergeReviewBacklogPage");
    expect(reviewScreen).toContain("Load more Review items");
    expect(reviewScreen).toContain("Review changed while more items were loading");
  });
});
