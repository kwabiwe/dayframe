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
});
