import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const timeline = readFileSync(fileURLToPath(new URL("./TimeReviewViews.tsx", import.meta.url)), "utf8");

describe("Calendar in Blocks contract", () => {
  it("draws text in a darker or lighter shade of the block's own hue, with icon lines under the title (Calendar v3, 24 Oct 2026)", () => {
    expect(timeline).not.toContain('color: "var(--text-primary)"');
    expect(styles).toMatch(/\.calendar-time-block \{[^}]*color: color-mix\(in oklab, var\(--calendar-block-accent\) var\(--calendar-ink\), var\(--calendar-ink-mix\)\);/);
    expect(styles).toMatch(/--calendar-ink: 52%;\s*--calendar-ink-mix: #000000;/);
    expect(styles).toMatch(/--calendar-ink: 62%;\s*--calendar-ink-mix: #ffffff;/);
    expect(timeline).toContain("<CalendarDetailLines lines={calendarBlockDetailLines(displayEntry, capturedNow, clock)} />");
    expect(styles).toMatch(/\.calendar-entry-details \{[^}]*max-height: calc\(var\(--detail-lines, 0\) \* 15px\);/);
    expect(styles).not.toMatch(/calendar-entry-title-line|calendar-entry-length|calendar-entry-glyph|calendar-entry-detail-line/);
  });

  it("cuts the first word with an ellipsis when no whole word fits, keeping the title in layout (Calendar v3, owner OK)", () => {
    const rule = styles.match(/\.calendar-entry-title:has\(\.calendar-entry-words\.is-cut-first\) \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("display: flex");
    expect(rule).not.toContain("display: none");
    expect(styles).toMatch(/\.calendar-entry-word-cut \{[^}]*text-overflow: ellipsis;/);
    expect(styles).toMatch(/\.calendar-entry-word \{[^}]*white-space: nowrap;/);
  });

  it("lays Review suggestions out in the entries' own columns, below a hovered, selected or resizing entry; the now line runs behind every block", () => {
    const zOf = (selector: RegExp) => Number(styles.match(selector)?.[1]);
    const review = zOf(/\.calendar-review-block \{[^}]*z-index: (\d+);/);
    const raised = zOf(/\.calendar-time-block\.is-resizing,[\s\S]*?\{\s*z-index: (\d+) !important;/);
    const now = zOf(/\.calendar-now-line \{[^}]*z-index: (\d+);/);
    // Dense-day rules (24 Oct 2026): no lane of their own; the same columns as blocks.
    expect(timeline).toContain("...suggestions.map((suggestion) => ({ key: suggestion.key, top: suggestion.top, height: suggestion.height + calendarBlockVisualGapPx }))");
    expect(styles).not.toMatch(/\.calendar-review-block \{[^}]*width: 42%/);
    expect(raised).toBeGreaterThan(review);
    // Trello (Calendar page improvements): the now line no longer crosses a block's text. Entry
    // lanes start at z-index 2, so the line sits under all of them; its time shows in the axis pill.
    expect(now).toBeLessThan(2);
    expect(styles).toMatch(/\.calendar-now-pill \{[^}]*position: absolute;/);
    expect(timeline).toMatch(/className="calendar-now-pill"[\s\S]{0,500}?\{formatTime\(capturedNow, clock\)\}/);
    // The pill's clock time is the browser's, so it only renders after hydration, and it is clamped
    // inside the axis at midnight and at the day's end.
    expect(timeline).toContain("localTimeReady && visibleDays.some(isToday)");
    expect(timeline).toContain("Math.min(calendarHeight - NOW_PILL_HALF_HEIGHT, Math.max(NOW_PILL_HALF_HEIGHT,");
    // Sticky day headings stay above everything in the columns.
    expect(raised).toBeLessThan(40);
  });

  it("keeps Calendar's clock moving while nothing runs, so the now line advances", () => {
    expect(timeline).toContain("hasRunningEntry ? 1_000 : 30_000");
  });
});
