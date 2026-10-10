import { describe, expect, it } from "vitest";
import { basePaletteCommands, filterPaletteCommands, searchResultCommand } from "./command-palette";
import type { GlobalSearchResult } from "./global-search";

const activities = [
  { id: "focus", name: "Focus", color: "mint", isPinned: true },
  { id: "admin", name: "Admin", color: "steel", isPinned: false }
];

describe("command palette", () => {
  const commands = basePaletteCommands({ activities, theme: "dark" });

  it("opens on pinned Starts, then Go to, Add and Settings", () => {
    expect(filterPaletteCommands(commands, "").map((command) => command.label)).toEqual([
      "Start Focus",
      "Today", "Calendar", "Review", "Reports", "Library", "Settings", "Tags", "Places",
      "Add a block",
      "Switch to Daylight", "Keyboard shortcuts"
    ]);
  });

  it("finds every activity, section and command by what is typed", () => {
    expect(filterPaletteCommands(commands, "adm").map((command) => command.label)).toEqual(["Start Admin"]);
    expect(filterPaletteCommands(commands, "rep").map((command) => command.id)).toEqual(["go:reports"]);
    expect(filterPaletteCommands(commands, "spent").map((command) => command.id)).toEqual(["add-block"]);
  });

  it("shows the G hints and the theme the switch leads to", () => {
    expect(commands.find((command) => command.id === "go:calendar")?.hint).toBe("G C");
    expect(basePaletteCommands({ activities, theme: "light" }).find((command) => command.id === "theme")?.label).toBe("Switch to Midnight");
  });

  it("starts an activity with an empty description and no tags", () => {
    expect(commands[0].action).toEqual({ kind: "start", draft: { categoryId: "focus", description: "", tagNames: [] } });
  });

  it("turns past work into Start again or a link to where it lives", () => {
    const base: GlobalSearchResult = {
      id: "activity:1", kind: "activity", label: "Write proposal", detail: "Focus", occurredAt: "2026-10-09T10:00:00.000Z",
      entryId: "e1", categoryId: "focus", categoryName: "Focus", categoryColor: "mint", placeId: null,
      description: "Write proposal", tagNames: ["acme"], startedAt: null, stoppedAt: null, durationSeconds: null
    };
    expect(searchResultCommand(base)).toMatchObject({
      group: "Start again",
      action: { kind: "start", draft: { categoryId: "focus", description: "Write proposal", tagNames: ["acme"] } }
    });
    expect(searchResultCommand({ ...base, id: "entry:e1", kind: "entry" })).toMatchObject({
      group: "Found",
      action: { kind: "navigate", href: "/timeline?date=2026-10-09&scope=day&view=list&entry=e1" }
    });
    expect(searchResultCommand({ ...base, id: "place:p1", kind: "place", placeId: "p1" }).action).toEqual({ kind: "navigate", href: "/places#place-p1" });
  });
});
