import { describe, expect, it } from "vitest";
import { analyzeTimeIntervals } from "@dayframe/shared";
import { prepareReviewOverlapCounts, reviewPeerEntries } from "./reviewPresentation";
import { REVIEW_PERFORMANCE_PROFILES, SYNTHETIC_REVIEW_NOW, syntheticReviewBootstrap, syntheticReviewEvidence } from "../../../../scripts/fixtures/review-performance";

describe("Review presentation preparation", () => {
  it("constructs mixed synthetic evidence profiles without private source data", () => {
    const data = syntheticReviewBootstrap(50);
    expect(new Set(data.reviewItems.map(item => item.eventType)).size).toBe(5);
    expect(new Set(syntheticReviewEvidence(data).map(item => item.segment.evidenceCount))).toEqual(new Set([8, 400]));
    const counts = [...prepareReviewOverlapCounts(data.reviewItems, reviewPeerEntries(data), SYNTHETIC_REVIEW_NOW).values()];
    expect(counts.some(count => count === 0)).toBe(true);
    expect(counts.some(count => count > 0)).toBe(true);
  });
  it.each(REVIEW_PERFORMANCE_PROFILES)("preserves interval counts for a %i-item mixed backlog", (size) => {
    const data = syntheticReviewBootstrap(size);
    const peers = reviewPeerEntries(data);
    expect(peers).toHaveLength(250);
    const prepared = prepareReviewOverlapCounts(data.reviewItems, peers, SYNTHETIC_REVIEW_NOW);
    for (const item of data.reviewItems) {
      const legacy = analyzeTimeIntervals([...peers, { id: item.id, startedAt: item.suggestedStartedAt!, stoppedAt: item.suggestedStoppedAt! }], { now: SYNTHETIC_REVIEW_NOW }).entries.find(x => x.id === item.id);
      expect(prepared.get(item.id)).toBe(legacy?.overlapCount ?? 0);
    }
  });
  it("ignores invalid windows and preserves the one-minute presentation warning threshold", () => {
    const data = syntheticReviewBootstrap(2);
    const item = data.reviewItems[0];
    item.suggestedStoppedAt = null;
    const peer = data.historyEntries![1];
    data.reviewItems[1].suggestedStartedAt = peer.startedAt;
    data.reviewItems[1].suggestedStoppedAt = new Date(Date.parse(peer.startedAt) + 59_999).toISOString();
    expect([...prepareReviewOverlapCounts(data.reviewItems, [peer], SYNTHETIC_REVIEW_NOW).values()]).toEqual([0, 0]);
  });
});
