import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const timer = source("./PersistentTimerBar.tsx");
const timeline = source("./TimeReviewViews.tsx");
const shell = source("./AppShell.tsx");
const datePicker = source("./DatePickerPopover.tsx");
const styles = source("../app/globals.css");

describe("web manual entry and Timeline control refinement", () => {
  it("reuses task suggestions in Add time (the shared editor) without starting a timer", () => {
    const manual = timer.slice(timer.indexOf("function ManualEntryEditor"), timer.indexOf("type QuickAction"));
    expect(manual).toContain("taskSuggestions={data.taskSuggestions}");
    expect(manual).toContain("taskSuggestionCandidates={data.taskSuggestionCandidates}");
    expect(manual).not.toContain("startTimer(");
  });

  it("anchors Tags and Suggestions below their triggers with internal bounds", () => {
    // The Tags button's list sits under the field at its full width, like the typed lists (14 Oct 2026).
    expect(styles).toMatch(/\.inline-tag-suggestions,\s*\.inline-activity-suggestions,\s*\.inline-tag-picker \{[^}]*top: calc\(100% \+ var\(--web-field-gap\)\);[^}]*left: 0;[^}]*right: 0;[^}]*max-height: min\(19rem, calc\(100dvh - 10rem\)\);/s);
    expect(styles).not.toContain(".manual-entry-");
  });

  it("hard-limits suggestions to five complete rows", () => {
    expect(timer).toContain("const TASK_SUGGESTION_LIMIT = 5");
    expect(timer).toContain(".slice(0, TASK_SUGGESTION_LIMIT)");
    expect(styles).toMatch(/\.swiss-task-suggestions \{[^}]*--task-suggestion-count: 5;/s);
    expect(styles).toMatch(/\.swiss-task-suggestions-list \{[^}]*grid-auto-rows: minmax\(var\(--task-suggestion-row-height\), auto\);[^}]*max-height: calc\(var\(--task-suggestion-count\) \* var\(--task-suggestion-row-height\)\);/s);
    expect(styles).toMatch(/\.swiss-task-suggestions-list \.df-flist-row \{[^}]*min-height: var\(--task-suggestion-row-height\);/s);
  });

  it("uses a neutral text selection globally, never coral (UIA-314)", () => {
    expect(styles).toMatch(/::selection \{[^}]*background: var\(--text-secondary\);[^}]*color: var\(--surface\);/s);
  });

  it("keeps the running-task menu below the More button and inside the viewport", () => {
    expect(styles).toMatch(/\.swiss-timer-actions-menu \{[^}]*position: absolute;[^}]*top: calc\(100% \+ 8px\);[^}]*right: 0;[^}]*max-width: min\(240px, calc\(100vw - 24px\)\);/s);
  });

  it("uses divider-free compact suggestion and tag rows", () => {
    const suggestionRows = styles.slice(
      styles.indexOf(".df-flist .df-flist-row {"),
      styles.indexOf(".df-flist .df-flist-row:hover")
    );
    expect(suggestionRows.length).toBeGreaterThan(0);
    // Suggestion and tag rows (typed or from the Tags button) are all the one FloatingList row.
    expect(suggestionRows).not.toContain("border-top");
    expect(styles).not.toContain(".inline-tag-picker-list");
    expect(styles).toMatch(/\.df-flist-search \{[^}]*height: var\(--web-control-height\);/s);
  });

  it("keeps date navigation geometry stable through one shared picker", () => {
    expect(timeline).toContain("<DatePickerPopover");
    expect(timeline).not.toContain("Selected day");
    expect(timeline).not.toContain("Selected week");
    expect(datePicker).toMatch(/>\s*Today\s*</);
    expect(datePicker).toContain("<DayframeCalendar");
    expect(datePicker).not.toContain('type="date"');
    expect(datePicker).toContain("onChange(date)");
    expect(timeline).toMatch(/<DatePickerPopover[\s\S]*?portal[\s\S]*?portalAlign="center"[\s\S]*?today=\{todayKey \?\? state\.date\}/);
    expect(datePicker).toContain('portalAlign?: "center" | "start"');
    expect(datePicker).toContain('triggerRect.left + (triggerRect.width - width) / 2');
    expect(styles).toMatch(/\.timeline-range-navigation \{[^}]*grid-template-columns: var\(--web-icon-button-size\) minmax\(160px, 1fr\) var\(--web-icon-button-size\);/s);
    expect(styles).toMatch(/\.swiss-timeline-surface \.timeline-range-navigation \{[^}]*grid-template-columns: var\(--web-icon-button-size\) max-content var\(--web-icon-button-size\);/s);
    expect(styles).toMatch(/\.swiss-timeline-surface \.timeline-date-picker \{[^}]*min-width: 120px;/s);
  });

  it("keeps Calendar zoom visible and removes redundant instruction copy", () => {
    expect(timeline).not.toContain("Hover for Play");
    expect(timeline).not.toContain('summary="View options"');
    expect(timeline).toContain('aria-label="Calendar zoom"');
  });
});
