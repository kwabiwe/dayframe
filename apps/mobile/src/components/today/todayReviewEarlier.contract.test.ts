import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const dashboard = source("../DayframeDashboard.tsx");
const nudge = source("./TodayReviewNudge.tsx");
const review = source("../../../app/review.tsx");

describe("Today's way into earlier Review moments (14 Oct 2026)", () => {
  it("opens the Review segment the nudge names through the route parameter", () => {
    expect(nudge).toContain("onPress={() => onOpenReview(copy.segment)}");
    expect(dashboard).toMatch(/onOpenReview=\{\(segment\) => segment\s*\? router\.push\(\{ pathname: "\/review", params: \{ segment \} \}\)\s*: router\.push\("\/review"\)\}/);
    // Its colours stay those of today's awaiting moments.
    expect(nudge).toContain(".filter((activity) => activity.awaitingDecision)");
  });

  it("counts open Review moments per earlier day from the same items the Calendar draws", () => {
    expect(dashboard).toContain("earlierDayReviewCounts(earlierDays, (calendarData?.reviewItems ?? []).filter(isOpenReviewItem))");
    expect(dashboard).toContain("reviewCounts={earlierDayReviewCountMap}");
  });

  it("orders the offline deck by suggested start, as the backlog does", () => {
    expect(review).toContain("if (!reviewBacklog) return orderReviewItemsByStart(cachedOpenReviewItems);");
  });
});
