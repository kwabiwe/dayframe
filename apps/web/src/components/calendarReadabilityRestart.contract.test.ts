import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const timeline = source("./TimeReviewViews.tsx");
const runtime = source("./AppShellRuntime.tsx");
const entries = source("./EntriesTable.tsx");
const compactEditor = source("./CalendarEntryCompactEditor.tsx");
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
    expect(timeline).toContain("const outcome = await startEntryAgain(entry)");
    expect(entries).toContain("await startEntryAgain(entry)");
    expect(runtime).toContain("entryContinuationDecision(entry)");
    expect(runtime).not.toContain("Stop it before starting another task.");
    expect(runtime).toContain("return startTimer(decision.draft)");
    expect(timeline).not.toContain('mode: "start"');
    expect(entries).not.toContain('mode: "start"');
  });

  it("surfaces an unsuccessful inline Start again outcome without moving Calendar layout", () => {
    expect(timeline).toContain("const [actionError, setActionError]");
    expect(timeline).toContain('continueCalendarEntry(entry, "inline")');
    expect(timeline).toContain("if (!outcome.ok)");
    expect(timeline).toContain("clearTimerError();");
    expect(timeline).toContain('if (surface === "inline") showActionError(outcome.error)');
    // The error is the BlocksToast error variant (an alert, fixed in the toast host), never a second
    // kind of toast (web UI audit WUI-027).
    expect(timeline).toMatch(/actionError && !undoToastVisible \? \(\s*<BlocksToast\s*actionLabel="Dismiss"[\s\S]*?message=\{actionError\}[\s\S]*?tone="error"/s);
    expect(styles).not.toContain(".timeline-delete-error");
  });

  it("keeps tiny blocks readable while isolating the portalled compact editor", () => {
    expect(timeline).toContain("layoutTimeBlockLanes");
    expect(timeline).not.toContain("<CalendarEntryDetails");
    expect(timeline).not.toContain("createPortal(");
    expect(timeline).toContain("<CalendarEntryCompactEditor");
    expect(compactEditor).toContain("createPortal(");
    expect(timeline).toContain("onDoubleClick={(event) =>");
    expect(timeline).toContain('className="calendar-entry-title"');
    expect(timeline).toContain('className="calendar-entry-detail-line tabular"');
    // Dense-day rules: a finished block of a minute or less is a short line, never a block.
    expect(timeline).toContain('className={`calendar-moment${selected ? " is-selected" : ""}`}');
  });

  it("preserves a distinct running state and compact hover action", () => {
    // Dense-day rules: no outline on any block; the running one keeps its breathing ring.
    expect(styles).toMatch(/\.calendar-time-block\.is-running::after \{[^}]*animation: df-live-breathe/);
    expect(styles).not.toMatch(/\.calendar-time-block\.is-running \{[^}]*outline:/);
    expect(styles).toContain(".calendar-start-again");
    expect(styles).toMatch(/\.calendar-start-again \{[^}]*bottom: 0;[^}]*width: 28px;[^}]*background: transparent;/s);
    expect(styles).toMatch(/\.calendar-time-block\.is-short \.calendar-start-again \{[^}]*top: 50%;[^}]*right: 0;/s);
    expect(styles).not.toMatch(/\.calendar-start-again \{[^}]*border-radius:/s);
    expect(styles).toMatch(/@media \(hover: none\)[\s\S]*\.calendar-start-again \{[^}]*display: none;/);
    expect(styles).toMatch(/@media \(pointer: coarse\)[\s\S]*\.calendar-start-again \{[^}]*display: none;/);
    expect(styles).toMatch(/@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.calendar-time-block:hover \.calendar-start-again/);
    // Play shows only where the column reserves room for it (Codex r3 on #545).
    expect(styles).toMatch(/@container calendar-time-block \(max-width: 111\.98px\) \{\s*\.calendar-start-again \{[^}]*display: none;/s);
    expect(styles).not.toContain(".calendar-time-block.is-selected .calendar-start-again");
    expect(styles).not.toContain(".calendar-time-block:focus-within .calendar-start-again");
  });

  it("keeps one compact radius, no outline, a colour bar and fill-led selection (dense-day rules)", () => {
    const blockRule = styles.match(/\.calendar-time-block \{([^}]*--calendar-block-radius:[^}]*)\}/)?.[1] ?? "";
    const selectedRule = styles.match(/\.calendar-time-block\.is-selected \{([^}]*)\}/)?.[1] ?? "";

    expect(blockRule).toContain("--calendar-block-radius: 6px");
    expect(blockRule).toContain("border: 0;");
    expect(styles).toMatch(/\.calendar-time-block::before,\s*\.calendar-review-block::before \{[^}]*width: 3px;[^}]*background: var\(--calendar-block-accent\);/s);
    expect(blockRule).toContain("border-radius: var(--calendar-block-radius)");
    expect(styles).not.toMatch(/\.calendar-time-block\.is-short\s*\{[^}]*border-radius:/s);
    expect(styles).not.toMatch(/\.calendar-time-block\.is-tiny\s*\{[^}]*border-radius:/s);
    expect(styles).not.toMatch(/\.calendar-time-block[^{]*\{[^}]*inset 3px 0 0 var\(--calendar-block-accent\)/s);
    expect(selectedRule).toContain("background-color: var(--calendar-block-selected-fill)");
    expect(selectedRule).not.toContain("outline");
    expect(styles).toMatch(/\.calendar-time-block:has\(\.calendar-entry-primary:focus-visible\) \{[^}]*outline: 2px solid var\(--focus\);/s);
    expect(styles).toMatch(/\.calendar-start-again \{[^}]*opacity: 0;[^}]*pointer-events: none;/s);
    expect(styles).not.toMatch(/\.calendar-start-again \{[^}]*visibility: hidden;/s);
    expect(styles).toMatch(/\.calendar-start-again:focus-visible \{[^}]*opacity: 1;[^}]*pointer-events: auto;/s);
    expect(timeline).toContain('onMouseDown={(event) => event.preventDefault()}');
  });

  it("keeps semantic lane ownership while applying visual-only gaps", () => {
    expect(timeline).toContain("calendarBlockVisualGeometry");
    expect(timeline).toContain("semanticBlockPositionStyle");
    expect(timeline).toContain("calendarBlockLaneInsets");
    expect(timeline).toContain("canShowTimeBlockInlineAction");
  });
});
