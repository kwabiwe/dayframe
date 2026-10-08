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
});
