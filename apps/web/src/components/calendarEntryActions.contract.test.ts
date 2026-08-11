import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const timeline = source("./TimeReviewViews.tsx");
const anchored = source("./CalendarEntryCompactEditor.tsx");
const quick = source("./TimeEntryQuickEditor.tsx");
const categoryPicker = source("./CategoryPicker.tsx");
const entries = source("./EntriesTable.tsx");
const reports = source("./ReportDetailsTable.tsx");
const styles = source("../app/globals.css");
const runtime = source("./AppShellRuntime.tsx");

describe("shared web time-entry quick editor", () => {
  it("uses one controller and panel across anchored and modal wrappers", () => {
    expect(quick).toContain("export function useTimeEntryQuickEditor");
    expect(quick).toContain("export function TimeEntryQuickEditorPanel");
    expect(quick).toContain("export function TimeEntryQuickEditorModal");
    expect(anchored).toContain("<TimeEntryQuickEditorPanel");
    expect(entries).toContain("<TimeEntryQuickEditorModal");
    expect(reports).toContain("<TimeEntryQuickEditorModal");
    expect(existsSync(fileURLToPath(new URL("./EditTimeEntryDialog.tsx", import.meta.url)))).toBe(false);
  });

  it("keeps Calendar anchoring and removes its advanced edit route", () => {
    expect(anchored).toContain("createPortal(");
    expect(anchored).toContain("calculateCalendarEditorPosition");
    expect(timeline).not.toContain("EditTimeEntryDialog");
    expect(timeline).not.toContain("editCalendarEntry");
    expect(timeline).not.toContain("setEditingEntry");
    expect(timeline).toContain('event.key === "Enter" || event.key === " " || event.key === "Spacebar"');
    expect(timeline).toContain('current.entryId === target.entryId');
  });

  it("renders tags, compact category selection, icon-only dates and local day offsets", () => {
    expect(quick).toContain("<InlineTagInput");
    expect(quick).toContain("selectedTagNames={draft.tagNames}");
    expect(quick).toContain("<CategoryPicker");
    expect(categoryPicker).toContain('role="listbox"');
    expect(categoryPicker).toContain('aria-label="Categories"');
    expect(quick.match(/iconOnly/g)).toHaveLength(2);
    expect(quick).toContain("calendarEntryLocalDayOffset");
    expect(quick).toContain("calendar-compact-day-offset");
    expect(quick).not.toContain("placeId");
    expect(quick).not.toContain("taskSuggestions");
    expect(quick).toContain("onEnter={controller.handleDescriptionEnter}");
    expect(quick).toContain('aria-label="Duration in hours and minutes"');
    expect(quick).toContain('placeholder="00:30"');
  });

  it("uses one fixed feedback plane with danger discard copy and equal action sizing", () => {
    expect(quick).toContain('data-feedback-mode={feedbackMode}');
    expect(quick).toContain("Discard changes?");
    expect(quick).toContain("Go back");
    expect(styles).toMatch(/\.calendar-compact-editor-footer \{[^}]*height:\s*var\(--calendar-compact-feedback-height\);[^}]*overflow:\s*hidden;/s);
    expect(styles).toMatch(/\.calendar-compact-discard-confirmation strong \{[^}]*color:\s*var\(--danger-text\);[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.2;/s);
    expect(styles).toMatch(/\.calendar-compact-save,[\s\S]*\.calendar-compact-discard-confirm \{[^}]*height:\s*var\(--web-control-height\);[^}]*font-size:\s*14px;[^}]*line-height:\s*1\.2;/s);
  });

  it("uses borderless inset fields, neutral focus, and three/two/one temporal columns", () => {
    expect(styles).toMatch(/\.calendar-compact-editor-panel input,[\s\S]*\.calendar-compact-category-field > button \{[^}]*border:\s*0;[^}]*background:\s*var\(--surface-inset\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor-panel input:focus \{[^}]*var\(--web-focus-border\)/s);
    expect(styles).toMatch(/\.calendar-compact-temporal-fields \{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
    expect(styles).toMatch(/@container time-entry-editor \(max-width: 380px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/s);
    expect(styles).toMatch(/@container time-entry-editor \(max-width: 340px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    expect(styles).toMatch(/\.calendar-compact-date-time-controls:focus-within \{[^}]*var\(--web-focus-border\)/s);
    expect(styles).toMatch(/\.calendar-compact-date-trigger \{[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.calendar-compact-date-trigger:hover,[\s\S]*background:\s*transparent;/s);
  });

  it("keeps the CSS-only Calendar text hierarchy and narrow-container fallback", () => {
    expect(styles).toMatch(/\.calendar-entry-description \{[^}]*font-weight:\s*650;/s);
    expect(styles).toMatch(/\.calendar-entry-category \{[^}]*font-weight:\s*400;/s);
    expect(styles).toMatch(/\.calendar-entry-tag \{[^}]*font-weight:\s*700;/s);
    expect(styles).toMatch(/\.calendar-entry-primary-metadata,[\s\S]*\.calendar-entry-tag-count \{[^}]*color:\s*color-mix\(in srgb, var\(--foreground\) 68%, var\(--surface\)\);/s);
    expect(styles).toMatch(/@container calendar-time-block \(max-width: 111px\)[\s\S]*\.calendar-entry-primary-metadata \{[^}]*display:\s*none;/s);
  });

  it("routes active edits through the shell mutation and keeps List ownership", () => {
    expect(timeline).toContain("updateActiveEntryFromCalendar({ plan })");
    expect(runtime).toContain("runActiveEntryCompactMutation");
    expect(entries).toContain('continueEntry(editingEntry, "editor")');
    expect(entries).toContain("onDeleteEntries([entry])");
    expect(timeline).toContain("useTimelineDeleteUndo");
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
