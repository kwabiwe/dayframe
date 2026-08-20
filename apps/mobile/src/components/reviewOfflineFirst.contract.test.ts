import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reviewSource = readFileSync("app/review.tsx", "utf8");
const detailSource = readFileSync("app/review/[id].tsx", "utf8");
const storeSource = readFileSync("src/lib/reviewSyncStore.ts", "utf8");

describe("offline-first Review screen contracts", () => {
  it("hydrates the Review list locally and keeps Health reprocessing separate", () => {
    expect(reviewSource).toContain("hydrateReviewFromCache");
    expect(reviewSource).toContain("startHealthReviewReprocess");
    expect(reviewSource).toContain("reprocessRunning && isHealthReviewItem(item)");
    expect(reviewSource).toContain("evidencePrefetcher.start");
  });

  it("hides mutations after the local transaction and preserves restore anchors", () => {
    expect(storeSource).toContain("'pending', 'hidden'");
    expect(storeSource).toContain("preceding_ids_json");
    expect(storeSource).toContain("following_ids_json");
    expect(storeSource).toContain("restoreReviewItemsWithAnchors");
  });

  it("renders cached evidence before revalidation and routes safe actions to the outbox", () => {
    expect(detailSource).toContain("loadCachedLocationReviewEvidence(id)");
    expect(detailSource).toContain("durableReviewMutationFromLocationAction(action)");
    expect(detailSource).toContain("await enqueueReviewMutation");
    expect(detailSource).toContain("void synchroniseReviewMutations().catch");
    expect(detailSource).not.toContain("key={evidence.reviewItemId}");
    expect(detailSource.indexOf("await enqueueReviewMutation")).toBeLessThan(
      detailSource.indexOf("router.back();")
    );
  });
});
