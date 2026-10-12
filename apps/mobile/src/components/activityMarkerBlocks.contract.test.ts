import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X3 (owner, Trello): iPhone activity markers are small rounded-square blocks, never round dots.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("iPhone activity markers are blocks (X3)", () => {
  it.each([
    ["./location/LocationReviewCorrectionEditor.tsx", "dot: { width: 8, height: 8, borderRadius: activityMarkerRadius(8) }"],
    ["./reports/ReportsTab.tsx", "dot: { height: 10, width: 10, borderRadius: activityMarkerRadius(10) }"]
  ])("%s uses the shared block marker radius", (path, rule) => {
    expect(read(path)).toContain(rule);
  });
});
