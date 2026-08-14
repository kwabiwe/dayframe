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
    expect(timer).toContain('className="manual-entry-inline-tags time-entry-quick-tags"');
    expect(styles).toMatch(/\.manual-entry-description \.swiss-task-suggestions \{[^}]*top: calc\(100% \+ var\(--web-field-gap\)\);[^}]*bottom: auto;/s);
    expect(styles).toMatch(/\.manual-entry-inline-tags \.inline-tag-picker \{[^}]*top: calc\(100% \+ var\(--web-field-gap\)\);[^}]*right: 0;[^}]*bottom: auto;[^}]*left: auto;/s);
    expect(styles).toMatch(/\.manual-entry-inline-tags \.inline-tag-picker \{[^}]*max-height: min\(240px, calc\(100dvh - 180px\)\);/s);
  });

  it("hard-limits suggestions to five complete rows", () => {
    expect(timer).toContain("const TASK_SUGGESTION_LIMIT = 5");
    expect(timer).toContain(".slice(0, TASK_SUGGESTION_LIMIT)");
    expect(styles).toMatch(/\.swiss-task-suggestions \{[^}]*--task-suggestion-count: 5;/s);
    expect(styles).toMatch(/\.swiss-task-suggestions-list \{[^}]*grid-auto-rows: minmax\(var\(--task-suggestion-row-height\), auto\);[^}]*max-height: calc\(var\(--task-suggestion-count\) \* var\(--task-suggestion-row-height\)\);/s);
    expect(styles).toMatch(/\.swiss-task-suggestions-list button \{[^}]*min-height: var\(--task-suggestion-row-height\);/s);
  });

  it("uses the shared quick-editor anatomy and borderless date-time controls", () => {
    const manual = timer.slice(timer.indexOf("function ManualEntryDialog"));
    expect(manual).toContain("<CategoryPicker");
    expect(manual).toContain('className="manual-entry-category"');
    expect(manual).toContain('variant="quick"');
    expect(manual).toContain('className="calendar-compact-editor-fields manual-entry-form"');
    expect(manual).toContain('className="calendar-compact-temporal-fields manual-entry-temporal-fields"');
    expect(manual).toContain('className="calendar-compact-duration-field"');
    expect(manual).toContain('title="Add Time"');
    expect(manual).toContain('className="calendar-compact-cancel"');
    expect(manual).toContain('className="calendar-compact-save"');
    expect(manual).toMatch(/footer=\{\([\s\S]*?<OverlapNotice[\s\S]*?compact[\s\S]*?calendar-compact-cancel[\s\S]*?calendar-compact-save[\s\S]*?<\/\>/);
    expect(manual).toContain('<span className="tabular">{durationLabel}</span>');
    expect(manual).not.toContain('<strong className="tabular">{durationLabel}</strong>');
    expect(manual).not.toContain("<SelectField");
    expect(manual).toContain("<DayframeDateTimePicker");
    expect(timer).not.toContain('type="datetime-local"');
    expect(styles).toMatch(/\.dayframe-date-time-trigger \{[^}]*border-color: transparent;/s);
    expect(styles).toMatch(/\.calendar-compact-editor,[\s\S]*dialog\.ui-dialog\.manual-entry-dialog \{[^}]*--calendar-compact-horizontal-inset: 12px;[^}]*border-radius: 16px;[^}]*background: var\(--surface-raised\);[^}]*box-shadow: 0 22px 52px var\(--shadow-color\), var\(--shadow-raised\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor-header,[\s\S]*\.manual-entry-dialog \.ui-dialog-actions \{[^}]*gap: 12px;[^}]*padding: 10px var\(--calendar-compact-horizontal-inset\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor-header,[\s\S]*\.manual-entry-dialog \.ui-dialog-header \{[^}]*height: 64px;[^}]*min-height: 64px;[^}]*max-height: 64px;/s);
    expect(styles).toMatch(/\.manual-entry-dialog \.ui-dialog-actions \{[^}]*height: var\(--calendar-compact-feedback-height\);[^}]*min-height: var\(--calendar-compact-feedback-height\);[^}]*max-height: var\(--calendar-compact-feedback-height\);/s);
    expect(styles).toMatch(/\.manual-entry-dialog \.ui-dialog-actions \{[^}]*justify-content:\s*flex-end;/s);
    expect(styles).toMatch(/\.manual-entry-dialog \.ui-dialog-actions > \.overlap-notice\.is-compact \{[^}]*flex: 1 1 auto;[^}]*margin-right: auto;/s);
    expect(styles).toMatch(/\.calendar-compact-save,[\s\S]*?\.calendar-compact-cancel \{[^}]*width: var\(--calendar-compact-action-width\);[^}]*min-width: var\(--calendar-compact-action-width\);[^}]*max-width: var\(--calendar-compact-action-width\);/s);
    expect(styles).toMatch(/dialog\.ui-dialog:focus \{[^}]*outline: 0;/s);
  });

  it("uses the lighter Dayframe selection colour globally", () => {
    expect(styles).toMatch(/::selection \{[^}]*background: var\(--accent-soft\);[^}]*color: var\(--foreground\);/s);
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
    expect(datePicker).toContain("<DayframeCalendar");
    expect(datePicker).not.toContain('type="date"');
    expect(datePicker).toContain("onChange(date)");
    expect(timeline).toMatch(/<DatePickerPopover[\s\S]*?portal[\s\S]*?portalAlign="center"[\s\S]*?today=\{todayKey\}/);
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
