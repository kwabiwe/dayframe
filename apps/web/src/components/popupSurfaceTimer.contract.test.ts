import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const timerSource = readFileSync(
  fileURLToPath(new URL("./PersistentTimerBar.tsx", import.meta.url)),
  "utf8"
);
const tagSource = readFileSync(
  fileURLToPath(new URL("./InlineTagInput.tsx", import.meta.url)),
  "utf8"
);
const styles = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8"
);

describe("persistent timer floating surfaces", () => {
  it("keeps timer-owned overlays outside the shared panel clipping boundary", () => {
    expect(styles).toMatch(
      /\.swiss-persistent-timer\s*\{[^}]*overflow:\s*visible;/s
    );
    expect(timerSource).toContain(
      "ui-floating-surface swiss-task-suggestions"
    );
    expect(timerSource).toContain(
      "ui-floating-surface swiss-category-menu"
    );
    expect(tagSource).toContain(
      "ui-floating-surface inline-tag-picker"
    );
  });

  it("uses one semantic surface contract with bounded internal scrolling", () => {
    expect(styles).toMatch(
      /\.ui-floating-surface\s*\{[^}]*background:\s*var\(--surface-raised\);/s
    );
    expect(styles).toMatch(
      /\.ui-floating-surface\s*\{[^}]*border:\s*1px solid var\(--line\);/s
    );
    expect(styles).toMatch(
      /\.inline-tag-picker\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto;/s
    );
    expect(styles).toMatch(
      /\.inline-tag-picker-list\s*\{[^}]*overflow-y:\s*auto;/s
    );
    expect(styles).toMatch(
      /\.swiss-category-menu\s*\{[^}]*overflow-y:\s*auto;/s
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
    expect(timerSource).toContain("startDateInputRef.current?.focus()");
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
    expect(tagSource).toContain("inert={!pickerOpen}");
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

  it("keeps compact low-height panels inside the viewport", () => {
    expect(styles).toMatch(
      /@media \(min-width: 561px\) and \(max-width: 840px\) and \(max-height: 560px\)[\s\S]*\.inline-tag-picker\s*\{[^}]*calc\(100dvh - 240px\)/s
    );
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
