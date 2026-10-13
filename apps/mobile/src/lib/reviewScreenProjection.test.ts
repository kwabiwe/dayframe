import { describe, expect, it } from "vitest";
import { syntheticReviewBootstrap } from "../../../../scripts/fixtures/review-performance";
import { liveReviewItems, projectReviewScreenData } from "./reviewScreenProjection";
import type { MobileBootstrap } from "./api";

const cachedCopy = (data: MobileBootstrap): MobileBootstrap => ({
  ...data,
  reviewItems: data.reviewItems.map((item) => ({ ...item, rawPayload: null }))
});

describe("projectReviewScreenData (one Review data owner)", () => {
  it("takes membership and order from the store projection, not the capped bootstrap", () => {
    const server = syntheticReviewBootstrap(4);
    const projection = { ...cachedCopy(server), reviewItems: cachedCopy(server).reviewItems.slice(1).reverse() };
    const next = projectReviewScreenData({ base: server, projection, live: liveReviewItems(server), current: null });
    expect(next.reviewItems.map((item) => item.id)).toEqual(projection.reviewItems.map((item) => item.id));
    expect(next.entries).toBe(server.entries);
  });

  it("shows the live bootstrap copy while its proposal is unchanged, so the reason never alternates", () => {
    const server = syntheticReviewBootstrap(3);
    const next = projectReviewScreenData({ base: server, projection: cachedCopy(server), live: liveReviewItems(server), current: null });
    expect(next.reviewItems.map((item) => item.rawPayload)).toEqual(server.reviewItems.map((item) => item.rawPayload));
    const moved = { ...cachedCopy(server), reviewItems: cachedCopy(server).reviewItems.map((item, index) => index === 0 ? { ...item, suggestedStartedAt: "2026-08-28T10:00:00.000Z" } : item) };
    const changed = projectReviewScreenData({ base: server, projection: moved, live: liveReviewItems(server), current: next });
    expect(changed.reviewItems[0].suggestedStartedAt).toBe("2026-08-28T10:00:00.000Z");
    expect(changed.reviewItems[0].rawPayload).toBeNull();
  });

  it("shows the store's copy when only the confidence changed (Codex r1 on #372)", () => {
    const server = syntheticReviewBootstrap(2);
    const lowered = { ...cachedCopy(server), reviewItems: cachedCopy(server).reviewItems.map((item, index) => index === 0 ? { ...item, confidence: "low" } : item) };
    const next = projectReviewScreenData({ base: server, projection: lowered, live: liveReviewItems(server), current: null });
    expect(next.reviewItems[0].confidence).toBe("low");
  });

  it("keeps a store-only time-away subtype under the live copy (Codex r2 on #372)", () => {
    const server = syntheticReviewBootstrap(2);
    const cached = { ...cachedCopy(server), reviewItems: server.reviewItems.map((item, index) => index === 0
      ? { ...item, rawPayload: { qualificationReason: "same_place_outing", stopCount: 1 } } : { ...item, rawPayload: null }) };
    const next = projectReviewScreenData({ base: server, projection: cached, live: liveReviewItems(server), current: null });
    expect(next.reviewItems[0].rawPayload).toEqual(expect.objectContaining({ qualificationReason: "same_place_outing", stopCount: 1, durationSeconds: 1800 }));
    const again = projectReviewScreenData({ base: next, projection: cached, live: liveReviewItems(server), current: next });
    expect(again).toBe(next);
  });

  it("returns what is on screen when nothing changed (no re-render), and reuses unchanged cards", () => {
    const server = syntheticReviewBootstrap(3);
    const live = liveReviewItems(server);
    const first = projectReviewScreenData({ base: server, projection: cachedCopy(server), live, current: null });
    const again = projectReviewScreenData({ base: first, projection: cachedCopy(server), live, current: first });
    expect(again).toBe(first);
    const fewer = { ...cachedCopy(server), reviewItems: cachedCopy(server).reviewItems.slice(1) };
    const next = projectReviewScreenData({ base: first, projection: fewer, live, current: first });
    expect(next.reviewItems[0]).toBe(first.reviewItems[1]);
  });

  it("never mixes accounts", () => {
    const server = syntheticReviewBootstrap(2);
    const other = { ...cachedCopy(server), workspace: { id: "other-workspace", name: "Other" } };
    expect(projectReviewScreenData({ base: server, projection: other, live: liveReviewItems(server), current: server })).toBe(other);
  });
});
