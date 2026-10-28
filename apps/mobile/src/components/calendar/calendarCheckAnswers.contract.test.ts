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

  it("offers no answers in a build without a backend identity, where the outbox's record is not read (Codex r9 on #582)", () => {
    expect(dashboard).toContain("ownerKey: scopedOwnerKey ?? null,");
    expect(dashboard).toContain("onAnswerCheck={scopedOwnerKey\n");
    expect(dashboard).toContain("? (id, logged) => checkAnswers.answer(id, logged, id === openCalendarCheckId ? openCheckVenue.venue : null)\n                    : undefined}");
    expect(dashboard).not.toContain('"local"');
  });

  it("opens each \"?\" where its kind is handled, and asks none with a pending change of its own (Codex r10 on #582)", () => {
    expect(dashboard).toContain("onOpenCheck={(reviewItemId) => {");
    // A trip's question edits the trip on its own correction sheet (step 12, Codex r1 on #602): the List opens it
    // itself (Codex r2 on #610).
    expect(dashboard).toContain("onOpenTripLeg={locationCorrections.openTripLeg}");
    expect(dashboard).toContain("router.push(calendarCheckRoute(");
    expect(dashboard).not.toContain('router.push({ pathname: "/review/[id]", params: { id: reviewItemId } } as never)');
    expect(dashboard).toContain("pendingChange: reviewSyncStateIds.has(item.id)");
  });

  it("lets an earlier held card's delayed save leave a newer held card's Undo alone (Codex r11 on #582)", () => {
    const resolve = review.slice(review.indexOf("function resolveItem("), review.indexOf("function resolveItem(") + 2_000);
    expect(resolve).toContain("if (!options.fromHold) deckHold.flush();");
    expect(resolve).not.toMatch(/\n\s*deckHold\.flush\(\);/);
    const commit = review.slice(review.indexOf("commitHeldDeckDecisionRef.current = (held, verified = false) => {"), review.indexOf("function resolveItem("));
    expect(commit).toContain("outing ? { unlisted, affectedItems: [item, ...members], fromHold: true } : { unlisted, fromHold: true }");
  });

  it("saves the deck editor's change in the same claim → read → write order (Codex r11 on #582)", () => {
    const edit = review.slice(review.indexOf("async function saveEdit("), review.indexOf("async function createTimerSheetTag("));
    const claimAt = edit.indexOf("if (!claimReviewAnswer(editIds))");
    const readAt = edit.indexOf("await reviewAnswerStillOpen(currentData, editIds)");
    const writeAt = edit.indexOf("await enqueueReviewMutation({");
    expect(claimAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(claimAt);
    expect(writeAt).toBeGreaterThan(readAt);
    expect(edit).toMatch(/\} finally \{\s*releaseReviewAnswer\(editIds\);/);
    // Stale outcomes are silent in another account (the claim is still released in finally), and an item
    // already gone says so with the editor's alert (Codex r12 on #582).
    expect(edit).toContain("editOwner = reviewDataOwnerKey(currentData);");
    expect(edit).toMatch(/\} catch \(error\) \{\s*if \(editOwner && \(!dataRef\.current \|\| reviewDataOwnerKey\(dataRef\.current\) !== editOwner\)\) return false;/);
    expect(edit).toMatch(/\)\) throw new Error\("This suggestion is no longer available\."\);/);
    expect(edit).not.toMatch(/candidate\.id === editTarget\.item\.id\s*\)\) return false;/);
  });

  it("folds, asks, counts and saves the List's outings with the deck's eligibility", () => {
    expect(dashboard).toContain("return { open, ...calendarCheckOutings(open, reviewSyncStateIds) };");
    expect(dashboard).toContain("const { open, outings, folded } = calendarCheckBase;");
    expect(dashboard).toContain("Promise.all([readSuppressedReviewItemIds(scopedOwner), getReviewItemSyncStates()])");
    expect(dashboard).not.toContain("foldedOutingMemberIds(");
  });
});

describe("the Dashboard's sheet answers, Logs as and \"?\" kinds (Codex r2 on #610)", () => {
  it("keeps a sheet answer with changes on the phone before its corrections, and hides it while it waits", () => {
    // Every sheet answer, with or without new changes, through the one shared registration (Codex r6 on #610).
    expect(dashboard).toContain("const record = await waitForItemCorrections(correctionOwner, { id, itemId: check.segmentId, newIds: ids,");
    expect(dashboard).toContain("void waitForItemCorrections(owner, { id, itemId: check.segmentId, newIds: [],");
    expect(dashboard).not.toContain("holdAnswerAfterCorrections(");
    // And every Logs as path in the place sheets.
    const corrections = source("./useLocationCorrections.tsx");
    expect(corrections).toContain("await waitForItemCorrections(owner, { id, itemId: placeItemId, newIds, action: { kind: \"log\", categoryId } });");
    expect(corrections).not.toContain("holdAnswerAfterCorrections(");
    expect(dashboard).toContain("checkAnswers.answer(check.id, yes, null, { afterCorrections: id })");
    expect(dashboard).toContain("const answersAfterCorrections = useAnswersAfterCorrections({ data: shownCalendarData, owner: correctionOwner,");
    expect(dashboard).toContain("onDropped: (reviewItemId) => checkAnswers.restoreAnswered([reviewItemId]) });");
    expect(dashboard).toContain("!answersAfterCorrections.waitingIds.has(item.id)");
  });

  it("hides the \"?\" a Logs as resolved on the server (#609) at once", () => {
    expect(dashboard).toContain("correctionQueue.acknowledged.flatMap((item) => item.resolvedReviewItemIds ?? [])");
    expect(dashboard).toContain("!resolvedByCorrections.has(item.id)");
  });

  it("classifies each \"?\" so only Apple Health's and a legacy one without a segment ask under their row, and never sends a row to Review", () => {
    expect(dashboard).toContain("kinds: new Map(items.map((item) => [item.id, calendarCheckKind(item)] as const)),");
    expect(dashboard).toContain("checkKinds={calendarChecks.kinds}");
    expect(dashboard).toContain('if (isLocationReviewItem(item) && segmentId) return item.eventType === "commute_detected" ? "trip" : "place";');
    // onOpenCheck is the question's own "More…" / "Open it" only; it no longer looks a trip up as a fallback.
    expect(dashboard).not.toContain('each.kind === "trip" && each.id === segmentId && !each.blockIds.length');
  });
});
