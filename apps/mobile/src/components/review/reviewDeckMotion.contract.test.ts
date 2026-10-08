import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const deck = source("./ReviewDeck.tsx");
const screen = source("../../../app/review.tsx");

describe("Review deck motion contract (Blocks parity step 5b)", () => {
  it("gives the top card one pan owner that leaves the vertical axis to pull-to-refresh", () => {
    expect(deck).toContain("Gesture.Pan()");
    expect(deck).toContain(".enabled(top)");
    expect(deck).toContain(".activeOffsetX([-12, 12])");
    expect(deck).toContain(".failOffsetY([-14, 14])");
    expect(deck).toContain("runOnJS(playArmTick)()");
  });

  it("flies out, reports after the flight, and skips the flight with Reduce Motion", () => {
    expect(deck).toMatch(/if \(reduceMotion\) \{\s*runOnJS\(onThrow\)\(direction\);/);
    expect(deck).toContain("if (finished) runOnJS(onThrow)(direction);");
    expect(deck).toContain("withSpring(0, { ...BLOCKS_SPRING.sheet");
  });

  it("holds a thrown decision for Undo and saves it on leaving or backgrounding", () => {
    expect(screen).toContain("deckHold.hold({");
    expect(screen).toMatch(/return \(\) => \{\s*deckScreenActive\.current = false;\s*deckHold\.flush\(\);\s*\};\s*\}, \[deckHold\]\)/);
    expect(screen).toMatch(/if \(state !== "active"\) deckHold\.flush\(\);/);
    expect(screen).toContain('testID="review-deck-undo"');
    expect(screen).toContain("unrecordDeckDecision(");
  });

  it("keeps a saved decision out of the deck until its projection lands (r2 A)", () => {
    expect(screen).toContain("committingDeckKeys.has(key)");
    expect(screen).toContain("setDeckKeyCommitting(held.key, true);");
    expect(screen).toMatch(/const started = held\.logged[\s\S]*settled, failed\)/);
    expect(screen).toContain("if (!started) failed();");
    expect(screen).toContain("if (reviewMutations.current.has(item.id)) return false;");
  });

  it("does not count the held card in flight toward \"N of M\" (r2 B)", () => {
    expect(screen).toContain("const deckRemaining = heldInFlight ? deckSources.length - 1 : deckSources.length;");
    expect(screen).toContain("Math.max(totalNeedsReview - locallyDecidedCount, deckRemaining)");
    expect(screen).not.toMatch(/remaining: deckBacklogComplete\s*\?\s*deckSources\.length/);
  });

  it("hangs the All framed Undo toast out of flow so its exit moves nothing (r2 C)", () => {
    expect(screen).toContain("styles.reviewDeckToastUnderButton");
    expect(screen).not.toContain("reviewDeckToastInFlow");
    expect(deck).toContain("deckStyles.finishedActions");
  });

  it("celebrates after any own decision and locks the flying card's controls (r2 D, F)", () => {
    expect(screen).toContain("celebrate={celebrateDeckFinish.current}");
    expect(screen).toContain("lastDeckKeys.current.every((key) => ownDeckDecisionKeys.current.has(key))");
    expect(screen).not.toContain("lastDeckDecisionAt");
    expect(screen).toContain("controlsDisabled: card.controlsDisabled || card.key === flyingDeckKey");
    expect(screen).toContain("logDisabled={topDeckControlsDisabled || deckFlying}");
    expect(screen).toContain("skipDisabled={deckFlying || (topDeckSkipDefers && deckSources.length <= 1)}");
    expect(deck).toContain("reviewDeckArmDirection(dragX.value, event.translationX)");
  });

  it("keeps Undo in every deck state and never decides a cancelled gesture (r3 1, 2)", () => {
    expect(screen.match(/renderDeckToast\("under"\)/g)?.length).toBe(2);
    expect(screen).toContain('renderDeckToast("actions")');
    expect(deck).toContain(".onEnd((_event, success) => {");
    expect(deck).toContain("if (direction !== 0 && success) {");
  });

  it("retires a cut-short flight on the save outcome and flushes a held card on any decision (r3 3, 4)", () => {
    expect(screen).toMatch(/const settled = \(\) => \{\s*setDeckKeyCommitting\(held\.key, false\);\s*setFlyingDeckKey/);
    expect(screen).toMatch(/if \(reviewMutations\.current\.has\(item\.id\)\) return false;\s*\/\/[^\n]*\n\s*deckHold\.flush\(\);/);
    expect(screen).toMatch(/if \(editTarget\.kind === "reviewItem"\) \{\s*deckHold\.flush\(\);/);
  });

  it("locks a deferred card's controls during its flight too (r3 6)", () => {
    expect(screen).toMatch(/setFlyingDeckKey\(key\);\s*if \(source\.kind === "legacy_entry" \|\| card\?\.skipDefers\) return;/);
  });

  it("restores a failed save as a fresh card and never saves a changed proposal (r4 1, 2)", () => {
    expect(screen).toMatch(/const failed = \(\) => \{[^}]*deferGenerations\.current\.set\(held\.key/);
    expect(screen).toContain("proposal: reviewDeckProposalSignature(item)");
    expect(screen).toContain("if (reviewDeckProposalSignature(item) !== held.proposal) {");
  });

  it("saves a throw reported after leaving at once, and Undo beats a ribbon focus (r4 3, 4)", () => {
    expect(screen).toContain("if (!deckScreenActive.current) deckHold.flush();");
    expect(screen).toMatch(/deckScreenActive\.current = false;\s*deckHold\.flush\(\);/);
    expect(screen).toContain("orderReviewDeck(ordered, returnKey ?? focusKey ?? stickyKey)");
  });

  it("counts Dismiss and a saved edit as this visit's own decisions for the celebration (r4 5)", () => {
    expect(screen.match(/ownDeckDecisionKeys\.current\.add\(reviewFocusKey\("review", (item|editTarget\.item)\.id\)\)/g)?.length).toBe(2);
  });
});
