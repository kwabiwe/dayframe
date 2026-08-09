import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sheet = readFileSync(fileURLToPath(new URL("./ActiveTimerEditSheet.tsx", import.meta.url)), "utf8");
const dashboard = readFileSync(fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)), "utf8");
const metadata = readFileSync(fileURLToPath(new URL("./TagMetadata.tsx", import.meta.url)), "utf8");
const theme = readFileSync(fileURLToPath(new URL("../lib/mobileTheme.ts", import.meta.url)), "utf8");

describe("mobile tag interaction contract", () => {
  it("keeps the autocomplete owned by the description field with bounded interruptible motion", () => {
    expect(sheet).toContain("findActiveHashtag");
    expect(sheet).toContain("duration: 140");
    expect(sheet).toContain("outputRange: reduceMotion ? [0, 0] : [-4, 0]");
    expect(sheet).toContain("useNativeDriver: true");
    expect(sheet).toContain("keyboardShouldPersistTaps=\"always\"");
  });

  it("distinguishes existing and create actions for VoiceOver and never persists from selection alone", () => {
    expect(sheet).toContain("Existing\"} tag,");
    expect(sheet).toContain("Create new tag,");
    expect(sheet).not.toContain("createTag(");
    expect(sheet).toContain("tagNames: appliedTagNames");
  });

  it("uses a compact shortcut and consumes selected hashtag commands into separate tag state", () => {
    expect(sheet).toContain("accessibilityLabel=\"Add a tag\"");
    expect(sheet).toContain("insertHashtagStarter");
    expect(sheet).toContain("selectionAfterDescriptionChange");
    expect(sheet).toContain("timeEntrySheetTagSessionReducer");
    expect(sheet).toContain('type: "description_blurred"');
    expect(sheet).toContain("pendingDescriptionSelectionSyncRef.current");
    expect(sheet).toContain("descriptionValueRef.current");
    expect(sheet).toContain("consumeActiveHashtag");
    expect(sheet).toContain("setSelectedTagNames");
    expect(sheet).not.toContain("descriptionWithTagTokens");
    expect(sheet).not.toContain("Type # to add a tag");
  });

  it("uses the shared framed chooser language, solid icon, and draft-only tag removal", () => {
    expect(theme).toMatch(/tagAutocompletePanel:\s*\{[\s\S]*?backgroundColor: theme\.surfaceRaised[\s\S]*?borderWidth: 1[\s\S]*?borderColor: theme\.borderStrong[\s\S]*?borderRadius: 14/);
    expect(theme).toMatch(/tagAutocompleteHeader:\s*\{[\s\S]*?backgroundColor: theme\.surfaceMuted/);
    expect(theme).toMatch(/tagSuggestionDivider:\s*\{[\s\S]*?left: 12[\s\S]*?right: 12/);
    expect(sheet).toContain("styles.tagAutocompleteDivider");
    expect(metadata).toContain('fill={color}');
    expect(metadata).toContain('fillRule="evenodd"');
    expect(metadata).toContain('accessibilityLabel={`Remove tag ${tagName}`}');
    expect(sheet).toContain("onPressTag={(tagName) => {");
    expect(sheet).toContain("tagNames: appliedTagNames");
  });

  it("rolls back exact edited fields without erasing newer dashboard state", () => {
    expect(dashboard).toContain("const previousData = latestData.current");
    expect(dashboard).toContain("rollbackOptimisticTimeEntryPatch(");
    expect(dashboard).not.toContain("updateDashboardData(() => previousData)");
    expect(dashboard).not.toContain("setData(previousData)");
    expect(dashboard).not.toContain("ActivityIndicator");
  });
});
