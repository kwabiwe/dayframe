import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Codex r5 on #609: the Grid's "?" (suggestion blocks, the Places lane and its dialogs) come from the one decisions
// owner's projection, never raw bootstrap items, so a question held, saving or saved in the List isn't answerable there.
const source = readFileSync(join(process.cwd(), "src/components/TimeReviewViews.tsx"), "utf8");

describe("the Grid reads the shared pending decisions (Codex r5 on #609)", () => {
  it("feeds the projected items to the Grid's blocks, lane and dialogs", () => {
    expect(source).toMatch(/const gridReviewItems = useProjectedReviewItems\(data\.reviewItems\);/);
    expect(source).toMatch(/useGridCorrection\(\{[^}]*reviewItems: gridReviewItems/);
    const calendar = source.slice(source.indexOf("<CalendarReview"), source.indexOf("/>", source.indexOf("<CalendarReview")));
    expect(calendar).toContain("reviewItems={gridReviewItems}");
    expect(calendar).not.toContain("reviewItems={data.reviewItems}");
  });
});
