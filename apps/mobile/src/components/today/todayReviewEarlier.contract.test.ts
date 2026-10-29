import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const dashboard = source("../DayframeDashboard.tsx");
const checkAnswers = source("../calendar/useCalendarCheckAnswers.ts");

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
    expect(dashboard).toContain("decided: locallyDecidedIds, answering: checkAnswers.hiddenIds, resolved: resolvedByCorrections,");
    // The evening reminder opens the oldest "?" that still asks, or today's List when none does (never Review).
    expect(dashboard).toContain("openTodayChecksRef.current = () => askingChecks[0] ? openCheckOn(askingChecks[0].id) : openChecksOn(formatDateKey(new Date()));");
    expect(dashboard).toContain("if (!cancelled && current) openTodayChecksRef.current();");
  });

  it("counts open Review moments per earlier day from the same settled \"?\" the Calendar draws (Codex r1 on #617, #618)", () => {
    // An outing counts once on its day (PRD D19, PR 12c), folded as the deck and the List fold it (Codex r2 on #582);
    // settled as the Calendar settles them, so an acknowledged Logs as clears its day's chip at once, and a block that
    // ran into a trip counts only while it still asks on its block (location v4 design §7).
    expect(dashboard).toContain("() => earlierDayReviewCounts(earlierDays, calendarCheckBase.open.filter((item) => !calendarCheckBase.folded.has(item.id))),");
    expect(checkAnswers).toContain("const open = reviewItems.filter((item) => isOpenReviewItem(item) && (hidden.stillAsks?.(item) ?? true) && !hidden.decided.has(item.id)");
    expect(dashboard).toContain("reviewCounts={earlierDayReviewCountMap}");
  });
});
