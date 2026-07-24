import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const shell = source("./AppShell.tsx");
const dashboard = source("./DashboardRealtime.tsx");
const timeline = source("./TimeReviewViews.tsx");
const timer = source("./PersistentTimerBar.tsx");
const inlineTags = source("./InlineTagInput.tsx");
const entries = source("./EntriesTable.tsx");
const entriesRedirect = source("../app/entries/page.tsx");
const automationRedirect = source("../app/automation/page.tsx");
const styles = source("../app/globals.css");

describe("persistent timer shell contract", () => {
  it("mounts one timer owner in the persistent shell and none in either page", () => {
    expect(shell.match(/<PersistentTimerBar/g)).toHaveLength(1);
    expect(shell).toContain("<AppShellRuntimeProvider>");
    expect(dashboard).not.toContain("CurrentTimerPanel");
    expect(timeline).not.toContain("CurrentTimerPanel");
  });

  it("routes Shift+Space and list Continue through the shared owner", () => {
    expect(shell).toContain("void toggleTimer()");
    expect(entries).toContain("await startEntryAgain(entry)");
    expect(entries).not.toContain("await startTimer(");
    expect(entries).not.toContain('mode: "start"');
  });

  it("keeps the timer strip on one measured five-part control track", () => {
    expect(styles).toMatch(/\.swiss-persistent-timer-form \{[^}]*"description category manual time action";[^}]*minmax\(0, 1fr\)[^}]*var\(--web-icon-button-size\)[^}]*minmax\(132px, 144px\)[^}]*max-content;/s);
    expect(styles).toMatch(/\.swiss-persistent-timer \.swiss-manual-entry-action,[\s\S]*\.swiss-persistent-timer \.swiss-command-play \{[^}]*width: var\(--web-icon-button-size\);[^}]*height: var\(--web-icon-button-size\);/s);
    expect(styles).toMatch(/\.swiss-timer-time-control \{[^}]*grid-area: time;/s);
    expect(styles).toMatch(/\.swiss-persistent-time-button,[\s\S]*\.swiss-persistent-time-placeholder \{[^}]*height: var\(--web-control-height\);/s);
    expect(styles).not.toMatch(/\.swiss-command-play\.is-active \{[^}]*min-width:\s*92px/s);
    expect(styles).not.toContain(".swiss-entrybar-actions");
    expect(timer).toContain('label="More timer actions"');
    expect(timer).toContain("Delete running task");
    expect(timer).toContain("void deleteActiveTimer()");
  });

  it("keeps tags inside the task compound control and exposes the row to assistive technology", () => {
    const compoundControl = inlineTags.slice(
      inlineTags.indexOf('className="ui-compound-control inline-tag-input-anchor"'),
      inlineTags.indexOf('<span className="inline-tag-help"')
    );

    expect(compoundControl).toContain('className={`inline-tag-picker-trigger');
    expect(timer).toContain('className="swiss-timer-field-label swiss-timer-description-label"');
    expect(timer).toContain('aria-labelledby="persistent-timer-category-label persistent-timer-category-value"');
    expect(timer).toContain('aria-label="Timer is idle. Elapsed time 00:00."');
    expect(timer).toContain('aria-label={active ? "Stop timer" : "Start timer"}');
    expect(timer).toContain("disabled={isTimerBusy}");
    expect(inlineTags).toContain("selectedTagNames.map");
    expect(inlineTags).toContain("Remove tag ${tagName}");
  });

  it("keeps compact overlays and the timer row usable at phone widths", () => {
    expect(styles).toMatch(/@media \(max-width: 840px\)[\s\S]*"category manual time action";[\s\S]*minmax\(104px, 118px\)/);
    expect(styles).toMatch(/@media \(max-width: 350px\)[\s\S]*"category category category"[\s\S]*"manual time action";/);
    expect(styles).toMatch(/\.swiss-category-menu \{[^}]*max-width: calc\(100vw - 24px\);[^}]*max-height: min\(232px, calc\(100dvh - 96px\)\);/s);
    expect(styles).toMatch(/\.swiss-category-trigger \{[^}]*width: 100%;[^}]*min-width: 0;/s);
    expect(styles).toMatch(/\.swiss-category-trigger-value \{[^}]*flex: 1 1 auto;[^}]*min-width: 0;[^}]*overflow: hidden;/s);
    expect(styles).toMatch(/\.swiss-category-trigger-value span:last-child \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
    expect(styles).toMatch(/\.swiss-category-trigger > svg \{[^}]*flex: 0 0 auto;/s);
  });

  it("keeps the manual dialog focused and removes the duplicate list form", () => {
    const manualDialog = timer.slice(timer.indexOf("function ManualEntryDialog"));
    expect(manualDialog).toContain('label="Category"');
    expect(manualDialog).toContain('label="Description"');
    expect(manualDialog).toContain('label="Start"');
    expect(manualDialog).toContain('label="Finish"');
    expect(manualDialog).not.toContain('label="Place"');
    expect(entries).not.toContain("submitManual");
    expect(entries).not.toContain("Add manual entry");
  });

  it("keeps the normal list to ordinary tracking fields", () => {
    expect(entries).toContain(">Task / tags<");
    expect(entries).not.toContain(">Source<");
    expect(entries).not.toContain(">Confidence<");
    expect(entries).not.toContain(">Review<");
  });

  it("preserves the approved compatibility redirects", () => {
    expect(entriesRedirect).toContain('redirect("/timeline?view=list")');
    expect(automationRedirect).toContain('redirect("/places")');
  });
});
