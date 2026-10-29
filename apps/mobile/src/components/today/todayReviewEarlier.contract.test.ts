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
  it("opens Calendar's List at the first thing to check from Today's chip, in place of the Review nudge (location v4 step 14)", () => {
    expect(dashboard).toContain("<TodayChecksChip count={checkCounts.today} onOpen={openTodayChecks}");
    expect(dashboard).not.toContain("<TodayReviewNudge");
    expect(dashboard).toContain('router.navigate("/(tabs)/calendar");');
    // A monotonic request id, so every tap reopens the first question (Codex r1 on #582).
    expect(dashboard).toContain("calendarCheckRequests.current += 1;");
    expect(dashboard).toContain("setCalendarCheckScroll(calendarCheckRequests.current);");
    // Counts use the List's own rule, and leave suggestions decided on this phone at once (Codex r1 on #573).
    expect(dashboard).toContain("listCheckOverlaps(check, todayStart, tomorrowStart)");
    // Owner, 28 Oct 2026 (concern 4): the badge counts the "?" that still ask, the last 7 days.
    expect(dashboard).toContain("week: askingChecks.length");
    expect(dashboard).toContain("!locallyDecidedIds.has(item.id)");
    // The evening reminder opens the oldest "?" that still asks, or today's List when none does (never Review).
    expect(dashboard).toContain("openTodayChecksRef.current = () => askingChecks[0] ? openCheckOn(askingChecks[0].id) : openChecksOn(formatDateKey(new Date()));");
    expect(dashboard).toContain("if (!cancelled && current) openTodayChecksRef.current();");
  });

  it("counts open Review moments per earlier day from the same items the Calendar draws", () => {
    expect(dashboard).toContain("const open = (shownCalendarData?.reviewItems ?? []).filter(isOpenReviewItem);");
    // An outing counts once on its day (PRD D19, PR 12c), folded as the deck and the List fold it (Codex r2 on #582).
    expect(dashboard).toContain("const { folded } = calendarCheckOutings(open, reviewSyncStateIds);");
    expect(dashboard).toContain("return earlierDayReviewCounts(earlierDays, open.filter((item) => !folded.has(item.id)));");
    expect(dashboard).toContain("reviewCounts={earlierDayReviewCountMap}");
  });

  it("orders the offline deck by suggested start, as the backlog does", () => {
    expect(review).toContain("if (!reviewBacklog) return orderReviewItemsByStart(cachedOpenReviewItems);");
  });
});
