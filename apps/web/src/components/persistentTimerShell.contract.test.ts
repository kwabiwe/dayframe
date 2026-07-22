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
const entries = source("./EntriesTable.tsx");
const entriesRedirect = source("../app/entries/page.tsx");
const automationRedirect = source("../app/automation/page.tsx");

describe("persistent timer shell contract", () => {
  it("mounts one timer owner in the persistent shell and none in either page", () => {
    expect(shell.match(/<PersistentTimerBar/g)).toHaveLength(1);
    expect(shell).toContain("<AppShellRuntimeProvider>");
    expect(dashboard).not.toContain("CurrentTimerPanel");
    expect(timeline).not.toContain("CurrentTimerPanel");
  });

  it("routes Shift+Space and list Continue through the shared owner", () => {
    expect(shell).toContain("void toggleTimer()");
    expect(entries).toContain("await startTimer({ categoryId, description, tagNames: entry.tagNames })");
    expect(entries).not.toContain('mode: "start"');
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
