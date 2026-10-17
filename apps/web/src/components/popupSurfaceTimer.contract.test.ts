import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const timerSource = readFileSync(
  fileURLToPath(new URL("./PersistentTimerBar.tsx", import.meta.url)),
  "utf8"
);
const taskSuggestionsSource = readFileSync(
  fileURLToPath(new URL("./TaskSuggestionsPanel.tsx", import.meta.url)),
  "utf8"
);
const floatingListSource = readFileSync(
  fileURLToPath(new URL("./FloatingList.tsx", import.meta.url)),
  "utf8"
);
const tagSource = readFileSync(
  fileURLToPath(new URL("./InlineTagInput.tsx", import.meta.url)),
  "utf8"
);
const categorySource = readFileSync(
  fileURLToPath(new URL("./CategoryPicker.tsx", import.meta.url)),
  "utf8"
);
const styles = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8"
);

describe("persistent timer floating surfaces", () => {
  it("keeps timer-owned overlays outside the shared panel clipping boundary", () => {
    // The Blocks command bar never clips its popovers (start time, More, suggestions).
    const commandRules = styles.match(/\.df-cmd(?:-wrap)?\s*\{[^}]*\}/g) ?? [];
    expect(commandRules.length).toBeGreaterThan(0);
    for (const rule of commandRules) expect(rule).not.toMatch(/overflow:\s*(hidden|clip|auto)/);
    // Suggestions (and the description's Tags and Activities) are the one FloatingList surface.
    expect(taskSuggestionsSource).toContain("<FloatingList");
    expect(taskSuggestionsSource).toContain("className={`swiss-task-suggestions");
    expect(floatingListSource).toContain("ui-floating-surface df-flist");
    expect(categorySource).toContain(
      "ui-floating-surface swiss-category-menu"
    );
    // The Activity block's and the Tags button's lists are that FloatingList too (owner, 14 Oct 2026).
    expect(categorySource).toContain("<FloatingList");
    expect(categorySource).toContain("`df-cmd-activity-panel");
    // The editors' "All activities" chip opens the same FloatingList (WUI-024).
    expect(categorySource).toContain('"df-more-activity-panel is-portalled time-entry-quick-editor-nested-surface"');
    expect(tagSource).toContain("className={`inline-tag-picker");
    expect(tagSource).not.toContain("ui-floating-surface inline-tag-picker");
  });

  it("uses one semantic surface contract with bounded internal scrolling", () => {
    expect(styles).toMatch(
      /\.ui-floating-surface\s*\{[^}]*background:\s*var\(--surface-raised\);/s
    );
    expect(styles).toMatch(
      /\.ui-floating-surface\s*\{[^}]*border:\s*1px solid var\(--line\);/s
    );
    // The Tags button's list is bounded like the typed lists (plus its search field); its rows
    // scroll inside (.df-flist-rows).
    expect(styles).toMatch(
      /\.inline-activity-suggestions,\s*\.inline-tag-picker\s*\{[^}]*max-height:\s*min\(19rem, calc\(100dvh - 10rem\)\);[^}]*overflow:\s*hidden;/s
    );
    expect(styles).toMatch(/\n\.inline-tag-picker \{\s*max-height: min\(22\.5rem, calc\(100dvh - 10rem\)\);\s*\}/);
    expect(styles).toMatch(
      /\.df-flist-rows\s*\{[^}]*overflow-y:\s*auto;/s
    );
    expect(styles).toMatch(
      /\.df-cmd-activity-panel\.is-portalled,[\s\S]*?\.df-more-activity-panel\.is-portalled\s*\{[^}]*position:\s*fixed;[^}]*max-height:\s*min\(22\.5rem, calc\(100dvh - 24px\)\);[^}]*overflow:\s*hidden;/s
    );
    expect(styles).toMatch(
      /\.swiss-category-menu\s*\{[^}]*overflow-y:\s*auto;/s
    );
    expect(styles).toMatch(
      /\.category-picker-menu\.is-portalled\s*\{[^}]*position:\s*fixed;[^}]*max-height:\s*min\(220px, calc\(100dvh - 24px\)\);[^}]*overflow-y:\s*auto;/s
    );
  });

  it("keeps the start editor anchored and non-modal with focus recovery", () => {
    expect(timerSource).toContain(
      "ui-floating-surface swiss-start-time-popover"
    );
    expect(timerSource).not.toContain(
      '<PopoverPanel title="Start date and time"'
    );
    expect(timerSource).toContain('role="dialog"');
    expect(timerSource).toContain("startEditorTriggerRef.current?.focus()");
    // The date field first, as the native date input was; Escape closes an open date picker
    // before the panel, and a press inside the portalled picker is not outside.
    expect(timerSource).toContain('querySelector<HTMLButtonElement>(".df-start-date-trigger")?.focus()');
    expect(timerSource).toContain('if (event.key !== "Escape" || startDatePickerOpenRef.current) return;');
    expect(timerSource).toContain('target.closest(".time-entry-quick-editor-nested-surface")');
    expect(styles).toMatch(
      /\.swiss-start-time-popover\s*\{[^}]*position:\s*absolute;/s
    );
    expect(timerSource).toContain("inert={!startEditorOpen}");
  });

  it("preserves accessible targets while removing the tag action fill", () => {
    expect(styles).toMatch(
      /\.inline-tag-picker-trigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s
    );
    expect(styles).toMatch(
      /\.inline-tag-picker-trigger:hover,\s*\.inline-tag-picker-trigger\.is-open\s*\{[^}]*background:\s*transparent;/s
    );
    expect(tagSource).toContain("<TagIcon size={15} />");
    expect(tagSource).toContain("pickerTriggerRef.current?.focus()");
    // FloatingList keeps a closed list mounted, hidden and inert.
    expect(tagSource).toContain("isOpen={effectivePickerOpen}");
    expect(floatingListSource).toContain("inert={!isOpen}");
  });

  it("uses one restrained presence transition with a reduced-motion path", () => {
    expect(styles).toMatch(
      /\.ui-floating-surface\s*\{[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;[^}]*translateY\(-4px\);/s
    );
    expect(styles).toMatch(
      /\.ui-floating-surface\.is-open\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;[^}]*translateY\(0\);/s
    );
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.ui-floating-surface,[\s\S]*transform:\s*none;/s
    );
  });

  it("gives the phone date sheet 44 px days (Codex r1 on #442)", () => {
    expect(styles).toMatch(/\.timeline-date-picker-panel\.is-sheet \.dayframe-calendar-grid button \{\s*min-height: 44px;/);
  });

  it("keeps the phone start panel above the tab bar", () => {
    expect(styles).toMatch(
      /@media \(max-width: 560px\) \{\s*\.df-cmd-time \.swiss-start-time-popover \{[^}]*bottom: calc\(var\(--df-tabbar-space, 0px\) \+ 8px\);/s
    );
  });

  it("keeps compact low-height panels inside the viewport", () => {
    expect(styles).toMatch(
      /@media \(min-width: 561px\) and \(max-width: 840px\) and \(max-height: 560px\)[\s\S]*\.swiss-category-menu\s*\{[^}]*calc\(100dvh - 308px\)/s
    );
    expect(styles).toMatch(
      /@media \(min-width: 561px\) and \(max-width: 840px\) and \(max-height: 560px\)[\s\S]*\.swiss-start-time-popover\s*\{[^}]*bottom:\s*calc\(100% \+ var\(--web-field-gap\)\);[^}]*calc\(100dvh - 224px\);/s
    );
    expect(styles).toMatch(
      /\.swiss-start-time-popover \.swiss-compact-time-editor\s*\{[^}]*overflow-y:\s*auto;/s
    );
  });
});
