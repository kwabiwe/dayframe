import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// X3 (owner, Trello): iPhone activity markers are small rounded-square blocks, never round dots.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("iPhone activity markers are blocks (X3)", () => {
  it.each([
    ["./location/LocationReviewCorrectionEditor.tsx", "dot: { width: 8, height: 8, borderRadius: activityMarkerRadius(8) }"],
    ["./settings/ActivityEditorSheet.tsx", "swatch: { borderColor: \"transparent\", borderRadius: activityMarkerRadius(36), borderWidth: 0, height: 36, width: 36 }"]
  ])("%s uses the shared block marker radius", (path, rule) => {
    expect(read(path)).toContain(rule);
  });
});
