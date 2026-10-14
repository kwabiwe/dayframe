import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const screen = source("../../../app/review.tsx");
const deck = source("./ReviewDeck.tsx");
const segments = source("./ReviewDeckSegments.tsx");

describe("Review deck Today · Earlier segments (owner decision 14 Oct 2026, option C)", () => {
  it("saves a held decision before switching segment, and ignores a tap on the selected one", () => {
    expect(screen).toMatch(/function selectDeckSegment\(next: ReviewDeckSegment\) \{\s*switchReviewDeckSegment\(deckSegmentRef\.current, next, \{\s*flushHeld: \(\) => deckHold\.flush\(\),/);
    // A focused card that lives in the other segment selects it the same way.
    expect(screen).toMatch(/if \(segment !== deckSegmentRef\.current\) \{[\s\S]*?deckHold\.flush\(\);\s*deckSegmentRef\.current = segment;\s*setDeckSegmentSwitched\(false\);\s*setDeckSegment\(segment\);/);
    expect(segments).toContain("if (isSelected) return;");
  });

  it("announces the new segment and moves VoiceOver to the top card's title once", () => {
    expect(screen).toContain("AccessibilityInfo.announceForAccessibility(reviewDeckSegmentAccessibilityLabel(segment, segmentCounts[segment]));");
    expect(screen).toContain("setSegmentFocusToken((token) => token + 1);");
    expect(screen).toContain("focusTitleToken={unspentSegmentFocusToken}");
    expect(deck).toContain('AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");');
    expect(segments).toContain('accessibilityRole="tablist"');
    expect(segments).toContain('accessibilityRole="tab"');
  });

  it("shows \"All framed\" only when both segments are empty, and \"Today is framed\" otherwise", () => {
    expect(screen).toContain("const deckFinished = deckSegmentSources.all.length === 0 && deckBacklogComplete;");
    expect(screen).toContain('deckView === "finished" ? (');
    expect(screen).toMatch(/deckView === "segment_framed" \? \(\s*<ReviewDeckSegmentFramed/);
    // The card thrown last keeps its Undo under "Today is framed" too.
    expect(screen).toMatch(/<ReviewDeckSegmentFramed[\s\S]*?footer=\{deckToastSlot\("under"\)\}/);
    // The celebration still reads every card, not one segment's.
    expect(screen).toContain("lastDeckKeys.current = deckSegmentSources.all.map((source) => source.key);");
  });

  it("makes \"N of M\", the auto-paging trigger and the bulk skip per segment", () => {
    expect(screen).toContain("decided: decidedInSegment,");
    expect(screen).toContain("exact: segmentCounts[deckSegment].exact");
    expect(screen).toContain('const segmentWantsPage = deckSources.length < 3 && (deckSegment === "earlier" || !deckTodayCovered);');
    expect(screen).toContain("bulkSkip={deckSegment}");
  });

  it("puts legacy entries in date order with the review items", () => {
    expect(screen).toContain("mergeReviewDeckChronology(openReviewItems, displayedReviewNeededEntries, {");
    expect(screen).not.toMatch(/\.\.\.openReviewItems\.map\(\(item\) => \(\{ key: reviewFocusKey\("review"/);
  });

  it("names an Earlier card's day on its picture and keeps the divider's row reserved", () => {
    expect(screen).toContain('dayPill: source.segment === "earlier" && Number.isFinite(start) ? reviewDeckDayWord(new Date(start), now) : null');
    expect(deck).toContain("{card.dayPill ? <DayPill label={card.dayPill} theme={theme} /> : null}");
    expect(screen).toContain("<ReviewDeckOlderDivider reduceMotion={reduceMotion} theme={theme} visible={showOlderDivider} />");
  });

  it("cross-fades the stacks with each card's presence fade and lands the new top card at its measured size", () => {
    // The other segment's top card is measured invisibly, so its picture never resizes after the fade.
    expect(screen).toContain("standby={standbyDeckCard}");
    expect(deck).toContain("const measuring = standby && !cards.some((card) => card.key === standby.key) ? standby : null;");
    expect(deck).toMatch(/standby: \{[^}]*opacity: 0,/);
    expect(deck).toContain("entering={returnFrom && !reduceMotion ? undefined : localPresenceEntering(reduceMotion)}");
    expect(deck).toContain("exiting={localPresenceExiting(reduceMotion)}");
  });

  it("slides the thumb with the sheet spring for the user's switch only, at once with Reduce Motion", () => {
    expect(segments).toContain("const thumbSpring = { ...BLOCKS_SPRING.sheet, reduceMotion: ReduceMotion.Never };");
    expect(segments).toContain("const animate = animateChange && placed.current && !reduceMotion;");
    // A tap or the "Today is framed" pill slides it; a focused card places it.
    expect(screen).toMatch(/setDeckReturn\(null\);\s*setDeckSegmentSwitched\(true\);/);
    expect(screen).toMatch(/setDeckSegmentSwitched\(false\);\s*setDeckSegment\(segment\);/);
    expect(screen).toContain("animateChange={deckSegmentSwitched}");
    expect(segments).toContain("thumbX.value = animate ? withSpring(target, thumbSpring) : target;");
  });

  it("opens the segment the route asks for, and a focused card's own segment", () => {
    expect(screen).toContain('() => parseReviewDeckSegmentParam(routeParams.segment) ?? "today"');
    expect(screen).toContain("beginExactFocus(focusKey, reviewDeckSegmentFor(reviewItemMoment(item), reviewDeckToday(Date.now())));");
  });
});
