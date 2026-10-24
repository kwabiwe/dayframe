import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const styles = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
const timeline = readFileSync(fileURLToPath(new URL("./TimeReviewViews.tsx", import.meta.url)), "utf8");

describe("Calendar in Blocks contract", () => {
  it("draws primary text on a tinted block, with the time and length line in secondary text (dense-day rules, 24 Oct 2026)", () => {
    expect(timeline).toContain('color: "var(--text-primary)"');
    expect(styles).toMatch(/\.calendar-entry-detail-line \{[^}]*color: var\(--text-secondary\);/);
    expect(styles).not.toMatch(/calendar-entry-title-line|calendar-entry-length|calendar-entry-glyph/);
  });

  it("keeps a colour-only title in layout so it can be measured again (Codex r3 on #579)", () => {
    const rule = styles.match(/\.calendar-entry-title:has\(\.calendar-entry-words\.is-none-fit\) \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("visibility: hidden");
    expect(rule).not.toContain("display: none");
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
