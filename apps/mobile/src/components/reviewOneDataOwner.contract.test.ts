import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const reviewSource = readFileSync("app/review.tsx", "utf8");

// Investigation 2026-10-12: load() committed the capped bootstrap list while every store change
// committed the cached projection, so each swipe flipped the deck (34 → 0 "All framed" → 34).
describe("Review screen has one data owner", () => {
  it("never commits the raw bootstrap Review list", () => {
    expect(reviewSource).not.toContain("commitBootstrap(bootstrap);");
    expect(reviewSource).not.toContain("mergeReviewBootstrapProjection");
    expect(reviewSource.match(/projectReviewScreenData\(/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("coalesces store changes into one projection re-read at a time", () => {
    expect(reviewSource).toMatch(/subscribeReviewSync\(\(\) => \{[\s\S]*?if \(read\.running\) \{[\s\S]*?read\.again = true;/);
  });
});
