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

  it("saves a held card only after claiming it and reading the outbox, by the List's own order", () => {
    const commit = review.slice(review.indexOf("commitHeldDeckDecisionRef.current = (held, verified = false) => {"), review.indexOf("function resolveItem("));
    // Claim, read the outbox, check again, save (Codex r6 on #582): the claim is taken before the read and
    // let go only when it ends, and the verified pass saves through resolveItem in the same turn.
    const claimAt = commit.indexOf("if (!claimReviewAnswer(ids)) {");
    const readAt = commit.indexOf("void reviewAnswerStillOpen(");
    expect(claimAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(claimAt);
    expect(commit).toMatch(/\.then\(\(outcome\) => \{\s*releaseReviewAnswer\(ids\);/);
    // Fenced to the account it began in, a failed read is a failed save, decided meanwhile saves nothing,
    // and otherwise everything is validated again as it is now (Codex r3 on #582).
    expect(commit).toContain("if (!dataRef.current || reviewDataOwnerKey(dataRef.current) !== owner) {");
    expect(commit).toMatch(/if \("error" in outcome\) \{[^}]*failed\(\);/);
    expect(commit).toMatch(/if \(!outcome\.open\) \{[^}]*settled\(\);\s*restoreMembers\(\);\s*undoCount\(\);/);
    expect(commit).toContain("commitHeldDeckDecisionRef.current(held, true);");
    expect(commit).toMatch(/if \(verified\) \{\s*start\(\);\s*return;\s*\}/);
  });

  it("claims a held bulk skip's moments for both surfaces while it saves, and lets them go after (Codex r5 on #582)", () => {
    const batch = review.slice(review.indexOf("function commitHeldBulkSkip("), review.indexOf("function commitHeldBulkSkip(") + 6_000);
    expect(batch).toContain("const claimed = held.items.filter((entry) => !reviewMutations.current.has(entry.itemId) && claimReviewAnswer([entry.itemId]));");
    expect(batch).toContain("const busy = held.items.filter((entry) => !claimed.includes(entry));");
    expect(batch).toContain("releaseReviewAnswer(claimed.map((entry) => entry.itemId));");
    // Holding the claims, it reads the outbox first: what Calendar › List decided meanwhile is resolved, and
    // an unreadable outbox fails every write (Codex r7 on #582).
    expect(batch.indexOf("await reviewAnswersDecided(")).toBeGreaterThan(batch.indexOf("claimReviewAnswer([entry.itemId])"));
    expect(batch.indexOf("await reviewAnswersDecided(")).toBeLessThan(batch.indexOf("runReviewBulkSkip<MobileReviewItem>(claimed"));
    expect(batch).toContain("decided: readFailed ? new Set() : decided,");
    expect(batch).toContain("if (readFailed) throw decided.error;");
  });

  it("folds, asks, counts and saves the List's outings with the deck's eligibility", () => {
    expect(dashboard).toContain("const { outings, folded } = calendarCheckOutings(open, reviewSyncStateIds);");
    expect(dashboard).toContain("Promise.all([readSuppressedReviewItemIds(scopedOwner), getReviewItemSyncStates()])");
    expect(dashboard).not.toContain("foldedOutingMemberIds(");
  });
});
