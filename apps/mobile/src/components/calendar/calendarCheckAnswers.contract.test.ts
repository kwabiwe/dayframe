import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const dashboard = source("../DayframeDashboard.tsx");
const review = source("../../../app/review.tsx");
const theme = source("../../lib/mobileTheme.ts");

describe("Calendar › List answers beside the deck and Today's toasts (Codex r2 on #582)", () => {
  it("stacks the answer's toast above a delete's or a notice in one measured column, never at a fixed offset", () => {
    const stackAt = dashboard.indexOf('testID="today-toast-stack"');
    expect(stackAt).toBeGreaterThan(-1);
    expect(dashboard).toContain('<View pointerEvents="box-none" style={[styles.todayToast, styles.todayToastStack]} testID="today-toast-stack">');
    const stack = dashboard.slice(stackAt, dashboard.indexOf("<PlayOrb", stackAt));
    // The answer first (on top), then the delete or the notice (on the bottom edge), each without a place of its own.
    expect(stack.indexOf('testID="calendar-check-toast"')).toBeLessThan(stack.indexOf('testID="today-delete-toast"'));
    expect(stack.indexOf('testID="today-delete-toast"')).toBeLessThan(stack.indexOf('testID="today-notice-toast"'));
    expect(stack).not.toContain("style={styles.todayToast}");
    expect(dashboard).not.toContain("bottom: 164");
    expect(theme).toMatch(/todayToastStack: \{\s*flexDirection: "column",\s*justifyContent: "flex-end",\s*gap: 8\s*\}/);
  });

  it("saves a card's remembered copy only while this phone has not decided it, by the List's own rule", () => {
    expect(review).toContain("void rememberedReviewAnswerStillOpen(");
    // Decided elsewhere meanwhile: nothing saved, the card not this visit's decision.
    const commit = review.slice(review.indexOf("commitHeldDeckDecisionRef.current = (held) => {"), review.indexOf("function resolveItem("));
    expect(commit).toMatch(/if \(open\) \{\s*start\(\);\s*return;\s*\}\s*\/\/ Decided elsewhere meanwhile[^\n]*\n\s*settled\(\);\s*restoreMembers\(\);\s*undoCount\(\);/);
  });

  it("folds, asks, counts and saves the List's outings with the deck's eligibility", () => {
    expect(dashboard).toContain("const { outings, folded } = calendarCheckOutings(open, reviewSyncStateIds);");
    expect(dashboard).toContain("Promise.all([readSuppressedReviewItemIds(scopedOwner), getReviewItemSyncStates()])");
    expect(dashboard).not.toContain("foldedOutingMemberIds(");
  });
});
