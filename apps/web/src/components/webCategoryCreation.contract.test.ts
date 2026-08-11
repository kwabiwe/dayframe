import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const picker = source("./CategoryPicker.tsx");
const runtime = source("./AppShellRuntime.tsx");
const timer = source("./PersistentTimerBar.tsx");
const timeline = source("./TimeReviewViews.tsx");
const entries = source("./EntriesTable.tsx");
const reports = source("./ReportDetailsTable.tsx");

describe("web contextual category creation contract", () => {
  it("offers creation in timer, Add Time, List, and Calendar create/edit pickers only", () => {
    expect(timer.match(/onCreateCategory=\{createCategory\}/g)).toHaveLength(2);
    expect(entries).toContain("onCreateCategory={createCategory}");
    expect(timeline.match(/onCreateCategory=\{createCategory\}/g)).toHaveLength(2);
    expect(reports).not.toContain("onCreateCategory");
  });

  it("publishes a name-only category mutation without submitting a surrounding form", () => {
    expect(runtime).toContain('clientFetch("/api/categories"');
    expect(runtime).toContain("body: JSON.stringify({ name })");
    expect(runtime).toContain("commitData({ ...current, categories }, \"optimistic\")");
    expect(picker).toContain("onCreateCategory(name)");
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
});
