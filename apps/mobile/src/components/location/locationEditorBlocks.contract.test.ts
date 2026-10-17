import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const editor = readFileSync(resolve(__dirname, "LocationReviewCorrectionEditor.tsx"), "utf8");
const screen = readFileSync(resolve(__dirname, "../../../app/review/[id].tsx"), "utf8");

describe("Location evidence editor in Blocks (UIA-027)", () => {
  it("selects neutrally and draws neutral map marks, never coral", () => {
    expect(editor).not.toMatch(/theme\.accent(Text|Soft)?\b/);
    expect(editor).toContain("accentColor={theme.textPrimary}");
    expect(editor).toContain('appearance={theme.mode === "dark" ? "dark" : "light"}');
    // Place rows stay neutral: raised and checked when chosen.
    expect(editor).toContain("{ backgroundColor: selected ? theme.surfaceMuted : theme.surfaceInset }");
  });

  // Staging feedback D1: the entry sheet's chips (the chosen one filled in its activity colour,
  // as in the entry sheet; never coral), then All activities with search and Create.
  it("chooses the activity with the shared Blocks chips and All activities picker", () => {
    expect(editor).toContain('import { ACTIVITY_CHIP_GAP, ActivityChip, ActivityChipRow, AllActivitiesChip, activityChipStyles } from "../ActivityChips";');
    // The chips and All activities fit into two rows, never the chosen chip dropped (owner, 17 Oct 2026).
    expect(editor).toContain("maxRows: 2,");
    expect(editor).toContain("selectedId: selectedCategoryId,");
    expect(editor).toContain("activityChips(categories, chipAnchorId, recentActivityIds)");
    expect(editor).toContain("<ActivityPickerSheet");
    expect(editor).toContain("onCreate={onCreateActivity}");
    expect(editor).not.toMatch(/^\s+horizontal$/m);
    expect(editor).not.toContain("function CategoryChoice");
    expect(screen).toContain("onCreateActivity={createActivity}");
    expect(screen).toContain("recentActivityIds={recentActivities}");
  });

  // Codex r1–r2 on #358: every user place edit supersedes a nearby/search pick still resolving, so
  // no control may hand a raw state setter to the map or the pin's name field.
  it("routes map-pin edits through the pick-superseding handlers", () => {
    expect(editor).toContain("editingCentre ? moveMapPin : undefined");
    expect(editor).toContain("onChangeText={renameMapPin}");
    expect(editor).toContain("onPress={togglePinEditor}");
    expect(editor).not.toMatch(/onSelectPoint=\{[^}]*setSelectedPoint/);
    expect(editor).not.toContain("onChangeText={setManualPlaceName}");
    for (const handler of ["togglePinEditor", "moveMapPin", "renameMapPin", "useManualMapPin", "changeSearchQuery", "clearPlaceSearch"]) {
      const body = editor.slice(editor.indexOf(`function ${handler}(`));
      expect(body.slice(0, body.indexOf("\n  }\n")), handler).toContain("supersedePlacePick();");
    }
  });

  it("uses the shared Settings switch and no spinner", () => {
    expect(editor).not.toMatch(/<Switch\b/);
    expect(editor).toContain('label="Save for future visits"');
    expect(screen).not.toContain("ActivityIndicator");
    expect(screen).toContain("Loading private map evidence…");
  });
});
