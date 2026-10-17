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
    expect(anchored).toContain("showCancel");
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

  it("renders tags, historical suggestions, compact category selection, icon-only dates and local day offsets", () => {
    expect(quick).toContain("<InlineTagInput");
    expect(quick).toContain("selectedTagNames={draft.tagNames}");
    expect(quick).toContain("<CategoryPicker");
    expect(categoryPicker).toContain('role="listbox"');
    expect(categoryPicker).toContain('aria-label="Activities"');
    expect(quick.match(/iconOnly/g)).toHaveLength(2);
    expect(quick).toContain("calendarEntryLocalDayOffset");
    expect(quick).toContain("calendar-compact-day-offset");
    expect(quick).not.toContain("placeId");
    expect(quick).toContain("taskSuggestions");
    expect(quick).toContain("<TaskSuggestionsPanel");
    expect(entries).toContain("taskSuggestions={shellData?.taskSuggestions ?? []}");
    expect(reports).toContain("taskSuggestions={shellData?.taskSuggestions ?? []}");
    expect(timeline).toContain("taskSuggestions={shellData?.taskSuggestions ?? []}");
    expect(quick).toContain("onEnter={controller.handleDescriptionEnter}");
    // Durations read as the app writes them everywhere ("30m", "1h 3m"; WUI-003), never "00:30".
    expect(quick).toContain('aria-label="Duration"');
    expect(quick).toContain('placeholder="30m"');
  });

  it("puts a note above the actions and asks about unsaved changes in the shared confirmation (WUI-004/WUI-005)", () => {
    // Blocks editor head (UIA-201): "Edit block" / "Running block" / "New block" under an eyebrow.
    expect(quick).toContain('const editorHeading = props.mode === "entry" ? (isRunning ? "Running block" : "Edit block") : "New block";');
    expect(quick).toContain("<h2>{editorHeading}</h2>");
    expect(quick).toContain('<p className="df-ed-eyebrow">{editorEyebrow}</p>');
    expect(quick).not.toContain('className="calendar-compact-editor-kicker"');
    expect(quick).toContain('data-feedback-mode={feedbackMode}');
    // The note (error or overlap) has its own line above the actions; it never shares their row.
    expect(quick).toMatch(/className=\{`df-ed-note[\s\S]*?className="df-ed-actions"/);
    expect(styles).toMatch(/\.df-ed-note \{[^}]*grid-template-rows:\s*0fr;/s);
    expect(styles).toMatch(/\.df-ed-note\.is-shown \{[^}]*grid-template-rows:\s*1fr;/s);
    // Unsaved changes: a real modal, not a footer swap.
    expect(quick).toContain("<ConfirmDialog");
    expect(quick).toContain('title="Discard unsaved changes?"');
    expect(quick).toContain('cancelLabel="Go back"');
    expect(quick).toContain('surfaceClassName="time-entry-quick-editor-nested-surface"');
    expect(quick).not.toContain("calendar-compact-discard-confirmation");
    expect(styles).toMatch(/\.calendar-compact-editor-footer\.df-ed-foot \{[^}]*height:\s*auto;[^}]*border-top:\s*0;[^}]*background:\s*transparent;/s);
    // Buttons never wrap and are at least the shared width.
    expect(styles).toMatch(/\.calendar-compact-save,\s*\.calendar-compact-cancel \{[^}]*width: max-content;[^}]*min-width:\s*var\(--calendar-compact-action-width\);[^}]*white-space: nowrap;/s);
  });

  it("uses borderless inset fields, neutral focus, and three/two/one temporal columns", () => {
    expect(styles).toMatch(/\.calendar-compact-editor-panel input,[\s\S]*\.calendar-compact-category-field > button \{[^}]*border:\s*0;[^}]*background:\s*var\(--surface-inset\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor-panel input:focus \{[^}]*var\(--web-focus-border\)/s);
    expect(styles).toMatch(/\.calendar-compact-temporal-fields \{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
    expect(styles).toMatch(/@container time-entry-editor \(max-width: 380px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/s);
    expect(styles).toMatch(/@container time-entry-editor \(max-width: 280px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
    // Time boxes (WUI-001): one inset box per field with the focus ring on the box, not an inner row.
    expect(styles).toMatch(/\.calendar-compact-editor-panel \.calendar-compact-temporal-fields > \* \{[^}]*border-radius:\s*12px;[^}]*padding:\s*7px 12px 6px;[^}]*background:\s*var\(--surface-inset\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor-panel \.calendar-compact-temporal-fields > \*:focus-within \{[^}]*var\(--web-focus-border\)/s);
    expect(styles).toMatch(/\.calendar-compact-date-trigger \{[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.calendar-compact-date-trigger:hover,[\s\S]*background:\s*transparent;/s);
    expect(quick).toContain('className="calendar-compact-duration-field"');
    expect(quick).toContain('<span className="calendar-compact-field-label">Duration</span>');
    expect(quick).not.toContain('<strong className="tabular">');
    expect(styles).toMatch(/\.calendar-compact-date-time-controls > input,[\s\S]*?\.calendar-compact-running-value \{[^}]*font-size:\s*15px;[^}]*font-weight:\s*400;[^}]*line-height:\s*21px;/s);
    expect(styles).toMatch(/\.dayframe-date-time-compact-value \{[^}]*font-size:\s*15px;[^}]*font-weight:\s*400;[^}]*line-height:\s*21px;/s);
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

  it("keeps Close alone in the head, puts Delete and Start again as labelled footer pills, and neutral selection in shared controls (WUI-006, UIA-205)", () => {
    expect(quick).toMatch(/className="calendar-compact-editor-icons">\s*<button[\s\S]*?aria-label="Close editor"[\s\S]*?<\/button>\s*<\/div>/);
    expect(quick).toMatch(/className="df-ed-actions-start"[\s\S]*?className="df-ed-pill is-danger"[\s\S]*?\{isRunning \? "Discard" : "Delete"\}[\s\S]*?className="df-ed-pill"[\s\S]*?Start again/);
    expect(quick).not.toContain("calendar-compact-start-again");
    expect(quick).not.toContain("df-ed-lead");
    expect(quick).toContain('{entry ? "Save" : "Add"}');
    expect(quick).toContain("<ActivityChipGroup");
    expect(quick).toContain('variant="more"');
    expect(styles).toMatch(/\.df-ed-pill\.is-danger \{[^}]*color: var\(--danger-text\);/);
    expect(styles).toMatch(/\.df-rbtn--danger \{[^}]*background: var\(--danger\);[^}]*color: var\(--on-danger\);/);
    for (const selected of [
      /\.ui-segmented-control button\[aria-pressed="true"\] \{([^}]*)\}/,
      /\.dayframe-calendar-grid button\[aria-pressed="true"\] \{([^}]*)\}/,
      /\.inline-tag-check\.is-selected \{([^}]*)\}/,
      /\.swiss-category-option\.is-selected \{([^}]*)\}/,
      /\.settings-workspace-switcher button\[aria-pressed="true"\] \{([^}]*)\}/
    ]) {
      expect(styles.match(selected)?.[1] ?? "missing").not.toMatch(/--accent/);
    }
  });
});

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}
