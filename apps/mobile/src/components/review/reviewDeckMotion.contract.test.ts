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
    expect(screen).toContain("useCallback(() => () => deckHold.flush(), [deckHold])");
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
    expect(screen).toContain("const deckRemaining = deckFlying ? deckSources.length - 1 : deckSources.length;");
    expect(screen).not.toMatch(/remaining: deckBacklogComplete\s*\?\s*deckSources\.length/);
  });

  it("hangs the All framed Undo toast out of flow so its exit moves nothing (r2 C)", () => {
    expect(screen).toContain("styles.reviewDeckToastUnderButton");
    expect(screen).not.toContain("reviewDeckToastInFlow");
    expect(deck).toContain("deckStyles.finishedActions");
  });

  it("celebrates after any own decision and locks the flying card's controls (r2 D, F)", () => {
    expect(screen).toMatch(/function recordDeckDecision\([^)]*\) \{\s*lastDeckDecisionAt\.current = Date\.now\(\);/);
    expect(screen).toContain("controlsDisabled: card.controlsDisabled || card.key === flyingDeckKey");
    expect(screen).toContain("logDisabled={topDeckControlsDisabled || deckFlying}");
    expect(screen).toContain("skipDisabled={deckFlying || (topDeckSkipDefers && deckSources.length <= 1)}");
    expect(deck).toContain("reviewDeckArmDirection(dragX.value, event.translationX)");
  });
});
