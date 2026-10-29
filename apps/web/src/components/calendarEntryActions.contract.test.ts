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
    // Time boxes (owner, 21 Oct 2026, superseding WUI-001): the label above, a transparent field, and
    // the value in a 44 px inset box with the 1 px idle line and the focus ring on the box.
    expect(styles).toMatch(/\.calendar-compact-editor-panel \.calendar-compact-temporal-fields > \* \{[^}]*gap:\s*6px;[^}]*padding:\s*0;[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.calendar-compact-editor-panel \.calendar-compact-date-time-controls,\n\.calendar-compact-editor-panel \.calendar-compact-duration-input input,\n\.calendar-compact-editor-panel \.calendar-compact-duration,\n\.calendar-compact-editor-panel \.calendar-compact-running-value \{[^}]*min-height:\s*44px;[^}]*border-radius:\s*12px;[^}]*background:\s*var\(--surface-inset\);[^}]*box-shadow:\s*inset 0 0 0 var\(--web-control-border-width\) var\(--control-border\);/s);
    expect(styles).toMatch(/\.calendar-compact-editor-panel \.calendar-compact-date-time-controls:focus-within,\n\.calendar-compact-editor-panel \.calendar-compact-duration-input input:focus \{[^}]*var\(--web-focus-border\)/s);
    // The date glyph keeps a full 44 × 44 target (Codex r1 on #465).
    expect(styles).toMatch(/\.calendar-compact-editor-panel \.calendar-compact-date-trigger \{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
    // The uppercase field labels are the editor panel's own: Add time keeps its labels (Codex r1 on #465).
    expect(styles).toMatch(/\n\.calendar-compact-field-label,\n\.calendar-compact-editor-description > label,\n\.calendar-compact-editor-fields label > span,\n\.calendar-compact-duration-field > span \{[^}]*font-size:\s*var\(--type-label\);[^}]*letter-spacing:\s*0\.02em;\n\}/);
    expect(styles).toMatch(/\.calendar-compact-editor-panel \.calendar-compact-field-label,[^{]*\{[^}]*text-transform:\s*uppercase;/s);
    // The touch rule comes after the "All activities" chip's 32 px, so it wins (Codex r1 on #465).
    const moreChip = styles.indexOf(".df-ed-chips .calendar-compact-category-field > .df-rchip--more {");
    const coarseChips = styles.indexOf("@media (any-pointer: coarse) {\n  .df-ed-chips .df-rchip,");
    expect(moreChip).toBeGreaterThan(-1);
    expect(coarseChips).toBeGreaterThan(moreChip);
    expect(styles).toMatch(/\.calendar-compact-date-trigger \{[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s);
    expect(styles).toMatch(/\.calendar-compact-date-trigger:hover,[\s\S]*background:\s*transparent;/s);
    expect(quick).toContain('className="calendar-compact-duration-field"');
    expect(quick).toContain('<span className="calendar-compact-field-label">Duration</span>');
    expect(quick).not.toContain('<strong className="tabular">');
    expect(styles).toMatch(/\.calendar-compact-date-time-controls > input,[\s\S]*?\.calendar-compact-running-value \{[^}]*font-size:\s*15px;[^}]*font-weight:\s*var\(--fw-regular\);[^}]*line-height:\s*21px;/s);
    // Add time's own date-time picker is retired (WUI-025): its CSS goes with it.
    expect(styles).not.toContain("dayframe-date-time");
  });

  it("lets the title win at every size, compact and narrow, whole words only (Calendar v3, 24 Oct 2026)", () => {
    expect(styles).toMatch(/\.calendar-entry-title \{[^}]*-webkit-line-clamp: var\(--title-lines-detailless, 1\);[^}]*font-size: 14px;[^}]*font-weight: var\(--fw-strong\);[^}]*line-height: 17px;[^}]*word-break: normal;/s);
    expect(styles).toMatch(/\.calendar-time-block\.is-dense-compact \.calendar-entry-title,[\s\S]*?\{[^}]*font-size: 11\.5px;[^}]*line-height: 14px;/s);
    expect(styles).toMatch(/@container calendar-time-block \(max-width: 89\.98px\)[\s\S]*?font-size: 11\.5px;/s);
    expect(styles).toMatch(/@container calendar-time-block \(min-width: 120px\)[\s\S]*?\.calendar-entry-details \{\s*display: grid;/s);
    expect(styles).toMatch(/@container calendar-time-block \(max-width: 21\.98px\)[\s\S]*?display: none;/s);
    expect(styles).toMatch(/\.calendar-entry-detail \{[^}]*font-size: 12px;[^}]*line-height: 15px;/s);
    // The title sits below the 6 px top resize handle.
    expect(styles).toMatch(/\.swiss-resize-handle\.top \{[^}]*height:\s*6px;/s);
    expect(styles).toMatch(/\.calendar-time-block\.can-direct-resize \.calendar-entry-primary \{[^}]*padding-top:\s*6px;/s);
    // Play's whole 44 px target (36 px in from the edge) sits inside the reserved 38 px.
    expect(styles).toMatch(/@container calendar-time-block \(min-width: 112px\) \{\s*\.calendar-time-block\.has-inline-action-slot \.calendar-entry-primary \{\s*padding-right: 38px;/s);
    // The retired length-on-the-title-line (accepted difference #2, replaced 24 Oct 2026) and metadata line are gone.
    expect(timeline).not.toContain("--calendar-length-chars");
    expect(styles).not.toContain("calendar-entry-primary-metadata");
    expect(styles).not.toContain("calendar-entry-tag-count");
  });

  it("routes active edits through the shell mutation and keeps List ownership", () => {
    expect(timeline).toContain("updateActiveEntryFromCalendar({ plan })");
    expect(runtime).toContain("runActiveEntryCompactMutation");
    expect(entries).toContain('continueEntry(editingEntry, "editor")');
    expect(entries).toContain("onDeleteEntries([entry])");
    expect(timeline).toContain("useTimelineDeleteUndo");
  });

  it("puts Start again and Delete as header icons before Close, leaves Cancel and Save in the footer, and neutral selection in shared controls (owner 21 Oct 2026, UIA-205)", () => {
    const icons = quick.slice(quick.indexOf('className="calendar-compact-editor-icons"'), quick.indexOf('aria-label="Close editor"'));
    expect(icons).toMatch(/data-tip="Start again"[\s\S]*?<DayframeIcon fill="currentColor" glyph="play"[\s\S]*?data-tip=\{isRunning \? "Discard" : "Delete"\}[\s\S]*?<DayframeIcon glyph="trash-2"/);
    expect(icons).toContain("aria-label={isRunning ? `Discard ${title}` : `Delete ${title}`}");
    expect(icons).toContain("aria-label={`Start again: ${title}`}");
    expect(quick).toContain('className="calendar-compact-icon-action is-close"');
    expect(quick).not.toContain("df-ed-pill");
    expect(quick).not.toContain("df-ed-actions-start");
    expect(styles).toMatch(/\.calendar-compact-editor-icons > \.is-close:not\(:first-child\) \{[^}]*margin-left: 8px;/);
    expect(quick).not.toContain("calendar-compact-start-again");
    expect(quick).not.toContain("df-ed-lead");
    expect(quick).toContain('{entry ? "Save" : "Add"}');
    expect(quick).toContain("<ActivityChipGroup");
    expect(quick).toContain('variant="more"');
    expect(styles).not.toContain(".df-ed-pill");
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
