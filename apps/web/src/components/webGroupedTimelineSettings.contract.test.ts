import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

const entries = source("./EntriesTable.tsx");
const deleteHook = source("./useTimelineDeleteUndo.ts");
const timer = source("./PersistentTimerBar.tsx");
const settings = source("./SettingsForms.tsx");
const goals = source("./GoalSettings.tsx");
const styles = source("../app/globals.css");

describe("grouped Timeline and Settings follow-up contracts", () => {
  it("groups, expands, restarts and highlights exact Timeline occurrences", () => {
    expect(entries).toContain("groupTimelineEntries");
    expect(entries).toContain('searchParams.get("entry")');
    expect(entries).toContain("timeline-group-count");
    expect(entries).toContain("startEntryAgain(entry)");
    expect(entries).toContain("timeline-entry-highlight");
    expect(entries).toContain(">Task<");
    expect(entries.indexOf(">Task<")).toBeLessThan(entries.indexOf(">Time<"));
    expect(entries).not.toContain(">Category<");
    expect(entries).toContain("timeline-task-category-dot");
    expect(entries).toContain("{timeEntryTitle(entry)}");
    expect(entries).toContain("{timeEntryCategoryLabel(entry)}");
    expect(entries).not.toContain("ChevronDown");
    expect(entries).toContain('colSpan={4}');
    expect(entries).toContain("EntryActionsMenu");
    expect(entries).toContain("Delete whole group");
    expect(entries).toContain("onDeleteEntries(isGrouped ? group.entries : [entry])");
    expect(entries).toContain("onDeleteEntries([occurrence])");
    expect(deleteHook).toContain('clientFetch("/api/time-entries/batch-delete"');
  });

  it("keeps quick editing on exact entries while aggregate rows remain full-editor only", () => {
    expect(entries).toContain("createTimelineInlineEditDraft");
    expect(entries).toContain("buildTimelineInlineSavePlan");
    expect(entries).toContain("updateTimelineInlineDescription");
    expect(entries).toContain("updateTimelineInlineTime");
    expect(entries).toContain("onDoubleClick");
    expect(entries).toContain("renderInlineDescription(entry, !isGrouped)");
    expect(entries).toContain("renderInlineDescription(occurrence)");
    expect(entries).toContain("Double-click to edit the latest occurrence");
  });

  it("offers the previous stop in the running start editor", () => {
    expect(timer).toContain("Set to last stop time");
    expect(timer).toContain("lastStoppedAt");
  });

  it("keeps settings actions uniform and password changes available in provider mode", () => {
    expect(goals).toContain("settings-save-row-goals");
    expect(settings).toContain('authMode === "local" || authMode === "provider"');
    expect(styles).toMatch(/\.settings-save-row-goals \{[^}]*justify-content: flex-end;/s);
    expect(styles).toMatch(/\.settings-save-row-goals \.ui-button \{[^}]*min-width: 104px;/s);
    expect(styles).toContain(".swiss-nav a:focus-visible");
  });
});
