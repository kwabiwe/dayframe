import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const picker = source("./CategoryPicker.tsx");
const styles = source("../app/globals.css");
const runtime = source("./AppShellRuntime.tsx");
const timer = source("./PersistentTimerBar.tsx");
const timeline = source("./TimeReviewViews.tsx");
const entries = source("./EntriesTable.tsx");
const reports = source("./ReportDetailsTable.tsx");
const quickEditor = source("./TimeEntryQuickEditor.tsx");

describe("web contextual category creation contract", () => {
  it("offers creation in timer, Add Time, List, and Calendar create/edit pickers only", () => {
    expect(timer.match(/onCreateCategory=\{createCategory\}/g)).toHaveLength(2);
    expect(entries).toContain("onCreateCategory={createCategory}");
    expect(timeline.match(/onCreateCategory=\{createCategory\}/g)).toHaveLength(2);
    expect(reports).not.toContain("onCreateCategory");
  });

  it("portals every create-enabled picker while leaving Reports in its existing flow", () => {
    expect(timer.match(/onCreateCategory=\{createCategory\}[\s\S]*?portal/g)).toHaveLength(2);
    expect(quickEditor).toContain("portal={Boolean(props.onCreateCategory)}");
    expect(picker).toContain("createPortal(menu, portalTarget)");
    expect(picker).toContain('triggerRef.current?.closest("dialog") ?? document.body');
    expect(reports).not.toContain("onCreateCategory");
    expect(reports).not.toContain("portal");
  });

  it("publishes an optional palette colour without submitting a surrounding form", () => {
    expect(runtime).toContain('clientFetch("/api/categories"');
    expect(runtime).toContain("body: JSON.stringify({ name, color })");
    expect(runtime).toContain("commitData({ ...current, categories }, \"optimistic\")");
    expect(picker).toContain("onCreateCategory(name, createColor ?? undefined)");
    expect(picker).toContain("DAYFRAME_PALETTE_PICKER.map");
    expect(picker).toContain("paletteKeyFor(undefined, createName.trim())");
    expect(picker).toContain(">Cancel</button>");
    expect(picker).toContain('type="button"');
    expect(picker).not.toContain("<form");
  });

  it("keeps blank, duplicate, failure, keyboard, and retry handling inside the shared picker", () => {
    expect(picker).toContain("Enter a category name.");
    expect(picker).toContain("already exists.");
    expect(picker).toContain("setCreateError(outcome.error)");
    expect(picker).toContain('event.key === "Enter"');
    expect(picker).toContain('event.key !== "Escape"');
    expect(picker).toContain("nameInputRef.current?.focus()");
  });

  it("uses borderless colour dots in both trigger variants and picker options", () => {
    expect(picker).toContain('className={variant === "timer" ? "swiss-category-trigger-value" : "category-picker-trigger-value"}');
    expect(picker).toContain('"calendar-compact-category-dot"');
    expect(styles).toMatch(/\.calendar-compact-category-dot\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
    expect(styles).toMatch(/\.category-picker-color-swatch\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s);
  });

  it("embeds the colour-dot action inside the category name compound control", () => {
    expect(picker).toContain('className="category-picker-create-name-control"');
    expect(picker).toContain('className="category-picker-color-trigger"');
    expect(picker).not.toContain('className="category-picker-create-color-field"');
    expect(styles).toContain("grid-template-columns: 44px minmax(0, 1fr)");
    expect(styles).toContain(".category-picker-create-name-control:focus-within");
  });

  it("keeps shared create typography, swatch geometry, and divider anatomy independent of host styles", () => {
    expect(styles).toMatch(/\.category-picker-create-form\s*\{[^}]*font-size:\s*14px;/s);
    expect(styles).toMatch(/\.category-picker-create-form\s*>\s*strong\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*650;/s);
    expect(styles).toMatch(/\.category-picker-create-name-field\s*>\s*label\s*\{[^}]*font-size:\s*12px;[^}]*font-weight:\s*650;/s);
    expect(styles).toMatch(/\.category-picker-create-form\s+\.category-picker-color-trigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
    expect(styles).toMatch(/\.category-picker-color-swatch\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
    expect(styles).toMatch(/\.category-picker-create-option::before\s*\{[^}]*top:\s*-7px;[^}]*right:\s*12px;[^}]*left:\s*12px;[^}]*height:\s*1px;/s);
    expect(styles).not.toContain(".calendar-compact-category-menu button {");
    expect(styles).not.toContain(".calendar-compact-category-menu .category-picker-create-form");
    expect(styles).toContain(".calendar-compact-category-menu .category-picker-options > button {");
  });
});
