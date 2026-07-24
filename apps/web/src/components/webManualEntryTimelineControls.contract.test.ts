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
  it("reuses task suggestions in manual entry without starting a timer", () => {
    const manual = timer.slice(timer.indexOf("function ManualEntryDialog"));
    expect(manual).toContain("data.taskSuggestions");
    expect(manual).toContain("<TaskSuggestionsPanel");
    expect(manual).toContain("setDescription(suggestion.description)");
    expect(manual).toContain("setCategoryId(suggestion.categoryId ??");
    expect(manual).toContain("setTagNames(suggestion.tagNames)");
    expect(manual).not.toContain("startTimer(");
  });

  it("anchors manual Tags and Suggestions below their triggers with internal bounds", () => {
    expect(timer).toContain('className="manual-entry-dialog"');
    expect(timer).toContain('className="manual-entry-inline-tags"');
    expect(styles).toMatch(/\.manual-entry-description \.swiss-task-suggestions \{[^}]*top: calc\(100% \+ var\(--web-field-gap\)\);[^}]*bottom: auto;/s);
    expect(styles).toMatch(/\.manual-entry-inline-tags \.inline-tag-picker \{[^}]*top: calc\(100% \+ var\(--web-field-gap\)\);[^}]*right: 0;[^}]*bottom: auto;[^}]*left: auto;/s);
    expect(styles).toMatch(/\.manual-entry-inline-tags \.inline-tag-picker \{[^}]*max-height: min\(240px, calc\(100dvh - 180px\)\);/s);
  });

  it("hard-limits suggestions to five complete rows", () => {
    expect(timer).toContain("const TASK_SUGGESTION_LIMIT = 5");
    expect(timer).toContain(".slice(0, TASK_SUGGESTION_LIMIT)");
    expect(styles).toMatch(/\.swiss-task-suggestions \{[^}]*--task-suggestion-count: 5;/s);
    expect(styles).toMatch(/\.swiss-task-suggestions-list \{[^}]*grid-auto-rows: var\(--task-suggestion-row-height\);[^}]*max-height: calc\(var\(--task-suggestion-count\) \* var\(--task-suggestion-row-height\)\);/s);
    expect(styles).toMatch(/\.swiss-task-suggestions-list button \{[^}]*height: var\(--task-suggestion-row-height\);/s);
  });

  it("reuses the timer Category treatment and borderless date-time controls", () => {
    const manual = timer.slice(timer.indexOf("function ManualEntryDialog"));
    expect(manual).toContain('className="swiss-category-field manual-entry-category"');
    expect(manual).toContain("<CategoryOption");
    expect(manual).not.toContain("<SelectField");
    expect(manual).toContain("manual-entry-date-time-control");
    expect(styles).toMatch(/\.manual-entry-category \.swiss-category-trigger,[\s\S]*\.manual-entry-date-time-control \{[^}]*border-color: transparent;/s);
    expect(styles).toMatch(/dialog\.ui-dialog:focus \{[^}]*outline: 0;/s);
  });

  it("keeps the running-task menu below the More button and inside the viewport", () => {
    expect(styles).toMatch(/\.swiss-timer-actions-menu \{[^}]*position: absolute;[^}]*top: calc\(100% \+ 8px\);[^}]*right: 0;[^}]*max-width: min\(240px, calc\(100vw - 24px\)\);/s);
  });

  it("uses divider-free compact suggestion and tag rows", () => {
    const suggestionRows = styles.slice(
      styles.indexOf(".swiss-task-suggestions-list button {"),
      styles.indexOf(".swiss-task-suggestions-list button:hover")
    );
    const tagRows = styles.slice(
      styles.indexOf(".inline-tag-picker-list button,"),
      styles.indexOf(".inline-tag-picker-list button:hover")
    );
    expect(suggestionRows).not.toContain("border-top");
    expect(tagRows).not.toContain("border-top");
    expect(styles).toMatch(/\.inline-tag-picker-search \{[^}]*height: var\(--web-control-height\);/s);
  });

  it("keeps date navigation geometry stable through one shared picker", () => {
    expect(shell).toContain("<DatePickerPopover");
    expect(timeline).toContain("<DatePickerPopover");
    expect(timeline).not.toContain("Selected day");
    expect(timeline).not.toContain("Selected week");
    expect(datePicker).toMatch(/>\s*Today\s*</);
    expect(datePicker).toContain('type="date"');
    expect(datePicker).toContain("onChange(date)");
    expect(styles).toMatch(/\.timeline-range-navigation \{[^}]*grid-template-columns: var\(--web-icon-button-size\) minmax\(160px, 1fr\) var\(--web-icon-button-size\);/s);
  });

  it("keeps Calendar zoom visible and removes redundant instruction copy", () => {
    expect(timeline).not.toContain("Hover for Play");
    expect(timeline).not.toContain('summary="View options"');
    expect(timeline).toContain('aria-label="Calendar zoom"');
  });
});
