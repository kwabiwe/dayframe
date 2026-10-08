import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reviewSource = readFileSync("app/review.tsx", "utf8");
const detailSource = readFileSync("app/review/[id].tsx", "utf8");
const storeSource = readFileSync("src/lib/reviewSyncStore.ts", "utf8");

describe("offline-first Review screen contracts", () => {
  it("hydrates the Review list locally and keeps Health reprocessing separate", () => {
    expect(reviewSource).toContain("hydrateReviewFromCache");
    expect(reviewSource).toContain("startHealthReviewReprocess");
    expect(reviewSource).not.toContain("reprocessRunning && isHealthReviewItem(item)");
    expect(reviewSource).not.toContain("setReprocessDiagnostics");
    expect(reviewSource).toContain("evidencePrefetcher.start");
    expect(reviewSource).toContain("recoverReviewAfterReconnect");
    expect(reviewSource).toContain("skipReprocess: true");
  });

  it("only stops presentation work after navigation actually begins", () => {
    expect(reviewSource).toContain('navigation.addListener("beforeRemove", stopReviewPresentationWork)');
    expect(reviewSource).toContain('if (event.data.closing) stopReviewPresentationWork();');
    // The Review deck's "‹ Today" back (Blocks step 5a) only navigates; beforeRemove stops the work.
    expect(reviewSource).toContain('accessibilityLabel="Back to Today"');
    expect(reviewSource).toMatch(/testID="review-deck-back"/);
    expect(reviewSource).not.toContain("stopReviewPresentationWork(); router.back()");
    expect(reviewSource).not.toContain('onPress={() => { stopReviewPresentationWork(); router.back(); }}');
  });

  it("hides mutations after the local transaction and preserves restore anchors", () => {
    expect(storeSource).toContain("'pending', 'hidden'");
    expect(storeSource).toContain("preceding_ids_json");
    expect(storeSource).toContain("following_ids_json");
    expect(storeSource).toContain("restoreReviewItemsWithAnchors");
  });

  it("renders cached evidence before revalidation and routes safe actions to the outbox", () => {
    expect(detailSource).toContain("loadCachedLocationReviewEvidence(id)");
    expect(detailSource).toContain("buildDurableLocationReviewCommand(action, reviewItem, data)");
    expect(detailSource).toContain("await enqueueReviewMutation");
    expect(detailSource).toContain("void synchroniseReviewMutations().catch");
    expect(detailSource).not.toContain("key={evidence.reviewItemId}");
    expect(detailSource).toContain("recoverEvidenceAfterReconnect");
    expect(detailSource).toContain("Showing evidence saved on this iPhone");
    expect(detailSource.indexOf("await enqueueReviewMutation")).toBeLessThan(
      detailSource.indexOf("router.back();")
    );
  });

  it("uses Settings-style titles and delays cold evidence feedback", () => {
    // The Review deck uses the prototype's compact nav title (Blocks step 5a).
    expect(reviewSource).toContain(
      '<Text {...mobileTextProps("control")} accessibilityRole="header" style={styles.reviewDeckNavTitle}>Review</Text>'
    );
    expect(detailSource).toContain(
      '<Text {...mobileTextProps("screenHeading")} style={styles.settingsTitle}>Location evidence</Text>'
    );
    expect(reviewSource).not.toContain('style={styles.settingsTitle} numberOfLines={1}');
    expect(detailSource).not.toContain('style={styles.settingsTitle} numberOfLines={1}');
    expect(reviewSource).not.toContain("DayframeBrand");
    expect(detailSource).not.toContain("DayframeBrand");
    expect(detailSource).toContain("scheduleLocationEvidenceLoadingFeedback");
    expect(detailSource).toContain("showHydrationFeedback ? (");
    expect(detailSource).toContain("hydrationFeedbackCancelRef.current?.();");
    expect(detailSource).toMatch(
      /if \(cachedEvidence\) \{[\s\S]*?finishHydrationFeedback\(generation\);[\s\S]*?const contextRequest/
    );
  });
});
