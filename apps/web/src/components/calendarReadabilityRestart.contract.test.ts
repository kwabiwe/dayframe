import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const timeline = source("./TimeReviewViews.tsx");
const runtime = source("./AppShellRuntime.tsx");
const entries = source("./EntriesTable.tsx");
const styles = source("../app/globals.css");

describe("Calendar readability and restart contract", () => {
  it("keeps one semantic primary action per block and pointer-only resize handles", () => {
    expect(timeline).toContain("<article");
    expect(timeline).toContain('className="calendar-entry-primary"');
    expect(timeline).not.toContain('aria-haspopup="dialog"');
    expect(timeline).not.toContain('role="button"');
    expect(timeline).toMatch(/<span[\s\S]*className="swiss-resize-handle top"[\s\S]*aria-hidden="true"/);
    expect(timeline).toMatch(/<span[\s\S]*className="swiss-resize-handle bottom"[\s\S]*aria-hidden="true"/);
    expect(timeline).not.toContain("tabIndex={-1}");
  });

  it("routes list and calendar continuations through the same guarded timer owner", () => {
    expect(timeline).toContain("await startEntryAgain(target.entry)");
    expect(entries).toContain("await startEntryAgain(entry)");
    expect(runtime).toContain("entryContinuationDecision(entry)");
    expect(runtime).not.toContain("Stop it before starting another task.");
    expect(runtime).toContain("return startTimer(decision.draft)");
    expect(timeline).not.toContain('mode: "start"');
    expect(entries).not.toContain('mode: "start"');
  });

  it("keeps tiny blocks readable without mounting a floating details surface", () => {
    expect(timeline).toContain("layoutTimeBlockLanes");
    expect(timeline).not.toContain("<CalendarEntryDetails");
    expect(timeline).not.toContain("createPortal(");
    expect(timeline).toContain("onDoubleClick={(event) =>");
    expect(timeline).toContain('className="calendar-entry-title"');
  });

  it("preserves a distinct running state and compact hover action", () => {
    const calendarRunningRule = styles.match(/\.calendar-time-block\.is-running \{([^}]*)\}/)?.[1] ?? "";
    expect(calendarRunningRule).toContain("border-style: dashed");
    expect(calendarRunningRule).not.toContain("outline:");
    expect(calendarRunningRule).not.toContain("opacity");
    expect(styles).toContain(".calendar-start-again");
    expect(styles).toMatch(/\.calendar-start-again \{[^}]*bottom: 2px;[^}]*width: 22px;[^}]*background: transparent;/s);
    expect(styles).toMatch(/\.calendar-time-block\.is-short \.calendar-start-again \{[^}]*top: 50%;[^}]*right: 1px;/s);
    expect(styles).not.toMatch(/\.calendar-start-again \{[^}]*border-radius:/s);
    expect(styles).toMatch(/@media \(hover: none\)[\s\S]*\.calendar-start-again \{[^}]*display: none;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*\.calendar-start-again \{[^}]*display: none;/);
    expect(styles).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.calendar-time-block:hover \.calendar-start-again/);
    expect(styles).not.toContain(".calendar-time-block.is-selected .calendar-start-again");
    expect(styles).not.toContain(".calendar-time-block:focus-within .calendar-start-again");
  });

  it("keeps one compact radius, a real hairline border, and fill-led selection", () => {
    const blockRule = styles.match(/\.calendar-time-block \{([^}]*--calendar-block-radius:[^}]*)\}/)?.[1] ?? "";
    const selectedRule = styles.match(/\.calendar-time-block\.is-selected \{([^}]*)\}/)?.[1] ?? "";

    expect(blockRule).toContain("--calendar-block-radius: 6px");
    expect(blockRule).toContain("border: 1px solid var(--calendar-block-border)");
    expect(blockRule).toContain("border-radius: var(--calendar-block-radius)");
    expect(styles).not.toMatch(/\.calendar-time-block\.is-short\s*\{[^}]*border-radius:/s);
    expect(styles).not.toMatch(/\.calendar-time-block\.is-tiny\s*\{[^}]*border-radius:/s);
    expect(styles).not.toMatch(/\.calendar-time-block[^{]*\{[^}]*inset 3px 0 0 var\(--calendar-block-accent\)/s);
    expect(selectedRule).toContain("background-color: var(--calendar-block-selected-fill)");
    expect(selectedRule).not.toContain("outline");
    expect(styles).toMatch(/\.calendar-time-block:has\(\.calendar-entry-primary:focus-visible\) \{[^}]*outline: 2px solid var\(--focus\);/s);
    expect(timeline).toContain('onMouseDown={(event) => event.preventDefault()}');
  });

  it("keeps semantic lane ownership while applying visual-only gaps", () => {
    expect(timeline).toContain("calendarBlockVisualGeometry");
    expect(timeline).toContain("semanticBlockPositionStyle");
    expect(timeline).toContain("calendarBlockLaneInsets");
    expect(timeline).toContain("canShowTimeBlockInlineAction");
  });
});
