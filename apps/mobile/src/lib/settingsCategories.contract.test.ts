/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(
  fileURLToPath(new URL("../../app/settings.tsx", import.meta.url)),
  "utf8"
);
const editorSource = readFileSync(
  fileURLToPath(new URL("../components/settings/ActivityEditorSheet.tsx", import.meta.url)),
  "utf8"
);

// Blocks parity step 6b-1: Settings › Activities and the activity editor sheet.
describe("mobile Activities page contract", () => {
  it("lists activities in the picker's groups with a week total and a 44-point pin, capped at six", () => {
    expect(settingsSource).toContain("activitiesPageGroups(data?.categories ?? []).map((group) => (");
    expect(settingsSource).toContain("formatActivityWeek(activityWeekSeconds.get(category.id) ?? 0)");
    expect(settingsSource).toContain("if (pinLimitReached(data?.categories ?? [], category.id)) {");
    // One activity change at a time (pins, saves, creates, archives; behaviour in
    // activitiesPage.test.ts), so a failing unpin never leaves seven pinned and a slow save never
    // brings back an archived activity.
    expect(settingsSource).toContain("const activityChanges = useRef(createActivityChangeGate()).current;");
    expect(settingsSource.match(/await activityChanges\.run\(async \(\) => \{/g)).toHaveLength(3);
    expect(settingsSource).toContain("if (activityChanges.busy()) {");
    // A pinned create checks quick start's room when it runs, not when the sheet opened.
    expect(settingsSource).toContain("activityCategoriesRef.current.filter((category) => category.isPinned).length < QUICK_START_PIN_LIMIT");
    expect(settingsSource).toContain("accessibilityState={{ selected: category.isPinned }}");
    expect(settingsSource).toContain('testID="activities-new"');
  });

  it("creates and edits through one editor sheet with name, icon and colour, and archives from it", () => {
    expect(settingsSource).toContain("<ActivityEditorSheet");
    expect(settingsSource).toContain("? await updateCategory(activity.id, { name: draft.name, color: draft.color, icon: draft.icon })");
    expect(settingsSource).toContain(": await createCategory(draft.name, { color: draft.color, icon: draft.icon, isPinned: pinned });");
    // Accepted saves and archives show at once, even if the refresh after them fails.
    expect(settingsSource).toContain("// The accepted activity shows at once, even if the refresh below fails.");
    expect(settingsSource).toContain("categories: current.categories.filter((category) => category.id !== activity.id)");
    expect(settingsSource).toContain("await archiveCategory(activity.id);");
    expect(editorSource).toContain("DAYFRAME_ACTIVITY_ICONS.map((option) => {");
    expect(editorSource).toContain("DAYFRAME_PALETTE_PICKER.map((option) => {");
    expect(editorSource).toContain('accessibilityRole="radiogroup"');
    expect(editorSource).toContain("activityNameProblem(activities, name, activity?.id ?? null)");
    // Archive asks first, and the sheet leaves with its own exit motion once archived.
    expect(editorSource).toMatch(/Alert\.alert\(`Archive \$\{target\.name\}\?`/);
    expect(editorSource).toContain("sheetRef.current?.dismiss();");
    expect(editorSource).toContain("<SwipeDismissSheet");
  });

  it("has no inline creator or editor left on the page", () => {
    expect(settingsSource).not.toContain("CategoryColorPicker");
    expect(settingsSource).not.toContain("newCategoryName");
    expect(settingsSource).not.toContain("editingCategoryId");
  });
});
