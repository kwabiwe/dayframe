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

  it("keeps manual Tags and Suggestions above the form with internal bounds", () => {
    expect(timer).toContain('className="manual-entry-dialog"');
    expect(timer).toContain('className="manual-entry-inline-tags"');
    expect(styles).toMatch(/\.manual-entry-description \.swiss-task-suggestions,[\s\S]*\.manual-entry-inline-tags \.inline-tag-picker \{[^}]*bottom: calc\(100% \+ var\(--web-field-gap\)\);/s);
    expect(styles).toMatch(/\.manual-entry-inline-tags \.inline-tag-picker \{[^}]*max-height: min\(240px, calc\(100dvh - 180px\)\);/s);
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
