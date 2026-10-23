import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const shell = source("./AppShell.tsx");
const today = source("./today/TodayView.tsx");
const timeline = source("./TimeReviewViews.tsx");
const timer = source("./PersistentTimerBar.tsx");
const categoryPicker = source("./CategoryPicker.tsx");
const inlineTags = source("./InlineTagInput.tsx");
const entries = source("./EntriesTable.tsx");
const entriesRedirect = source("../app/entries/page.tsx");
const automationRedirect = source("../app/automation/page.tsx");
const styles = source("../app/globals.css");

describe("persistent block shell contract", () => {
  it("mounts one block owner in the persistent shell and none in either page", () => {
    expect(shell.match(/<PersistentTimerBar/g)).toHaveLength(1);
    expect(shell).toContain("<AppShellRuntimeProvider>");
    expect(today).not.toContain("CurrentTimerPanel");
    expect(today).not.toContain("<PersistentTimerBar");
    expect(timeline).not.toContain("CurrentTimerPanel");
  });

  it("routes Shift+Space and list Continue through the shared owner", () => {
    expect(shell).toContain("void toggleTimer()");
    expect(entries).toContain("await startEntryAgain(entry)");
    expect(entries).not.toContain("await startTimer(");
    expect(entries).not.toContain('mode: "start"');
  });

  it("keeps the Blocks command bar on one track: activity, description, time, action, secondary", () => {
    expect(styles).toMatch(/\.df-cmd \{[^}]*grid-template-areas: "activity description time action secondary";/s);
    expect(styles).toMatch(/\.df-cmd-activity \{[^}]*width: 48px;[^}]*height: 48px;/s);
    expect(styles).toMatch(/\.df-cmd-go \{[^}]*height: 48px;[^}]*background: var\(--accent\);/s);
    expect(styles).toMatch(/\.df-cmd-time \{[^}]*grid-area: time;/s);
    expect(styles).toMatch(/\.df-cmd-secondary \{[^}]*grid-area: secondary;/s);
    expect(styles).toMatch(/\.df-cmd-icon\.ui-icon-button \{[^}]*width: 44px;[^}]*height: 44px;/s);
    expect(styles).not.toContain(".swiss-entrybar-actions");
    expect(timer).toContain('label="More block actions"');
    expect(timer).toContain("Discard running block");
    // Discard goes through the Undo-able path (WUI-008), which deletes and offers Undo.
    expect(timer).toContain("void discardRunningBlock()");
    expect(timer).toContain("const outcome = await deleteActiveTimer();");
  });

  it("keeps tags inside the block compound control and exposes the row to assistive technology", () => {
    const compoundControl = inlineTags.slice(
      inlineTags.indexOf('className="ui-compound-control inline-tag-input-anchor"'),
      inlineTags.indexOf('<span className="sr-only"')
    );

    expect(compoundControl).toContain('className={`inline-tag-picker-trigger');
    expect(timer).toContain('className="sr-only swiss-timer-description-label"');
    expect(timer).toContain('ariaLabelledBy="persistent-timer-category-label"');
    expect(categoryPicker).toContain("aria-labelledby={ariaLabelledBy}");
    expect(timer).toContain('aria-label="Nothing is recording. Elapsed time 00:00."');
    expect(timer).toContain('aria-label={active ? "Stop recording" : parsedCommand?.durationSeconds ? `${goLabel} ending now` : "Start a block"}');
    // Stop is never disabled by a save in flight; the runtime's gate makes it wait (stability audit WEB-UI-10).
    const goButton = timer.slice(timer.indexOf('className={`df-cmd-go${active ? " is-stop" : ""}`}'));
    expect(goButton.slice(0, goButton.indexOf("onClick="))).not.toMatch(/disabled=|aria-busy=/);
    expect(inlineTags).toContain("selectedTagNames.map");
    expect(inlineTags).toContain("#${tagName}, remove tag");
    expect(compoundControl).toContain('className="inline-selected-tags"');
    expect(compoundControl).toContain('className="inline-selected-tag-overflow"');
  });

  it("keeps compact overlays and the block row usable at phone widths", () => {
    expect(styles).toMatch(/@media \(max-width: 860px\)[\s\S]*\.df-cmd \{[^}]*"activity description action secondary"[^}]*"time time time time";/);
    expect(styles).toMatch(/@media \(max-width: 860px\)[\s\S]*\.df-quick-button \{[^}]*min-height: 44px;/);
    expect(styles).toMatch(/\.swiss-category-menu \{[^}]*max-width: calc\(100vw - 24px\);[^}]*max-height: min\(232px, calc\(100dvh - 96px\)\);/s);
    expect(styles).toMatch(/\.swiss-category-trigger \{[^}]*width: 100%;[^}]*min-width: 0;/s);
    expect(styles).toMatch(/\.swiss-category-trigger-value \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*overflow: hidden;/s);
    expect(styles).toMatch(/\.swiss-category-trigger-value span:last-child \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
    expect(styles).toMatch(/\.swiss-category-trigger > svg \{[^}]*flex: 0 0 auto;/s);
  });

  it("opens Add time as the shared New block editor and keeps the duplicate list form gone (WUI-025)", () => {
    const manual = timer.slice(timer.indexOf("function ManualEntryEditor"));
    expect(manual).toContain("<TimeEntryQuickCreateModal");
    expect(manual).toContain("onCreateCategory={onCreateCategory}");
    expect(manual).toContain("taskSuggestions={data.taskSuggestions}");
    // Add time's own rules stay on save: nothing after today (D2) and a valid manual window.
    expect(manual).toContain("Add time can't go past today.");
    expect(manual).toContain("validateManualTimeEntryWindow(");
    expect(timer).not.toContain("function ManualEntryDialog");
    expect(timer).not.toContain("DayframeDateTimePicker");
    expect(timer).not.toContain('title="Add Time"');
    expect(entries).not.toContain("submitManual");
    expect(entries).not.toContain("Add manual entry");
  });

  it("keeps the normal list to ordinary tracking fields", () => {
    expect(entries).toContain(">Block<");
    expect(entries).not.toContain(">Source<");
    expect(entries).not.toContain(">Confidence<");
    expect(entries).not.toContain(">Review<");
  });

  it("preserves the approved compatibility redirects", () => {
    expect(entriesRedirect).toContain('redirect("/timeline?view=list")');
    expect(automationRedirect).toContain('redirect("/places")');
  });
});
