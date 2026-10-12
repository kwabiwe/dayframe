import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const settings = readFileSync(resolve(__dirname, "../../../app/settings.tsx"), "utf8");
const blocks = readFileSync(resolve(__dirname, "SettingsBlocks.tsx"), "utf8");
const placeEditor = readFileSync(resolve(__dirname, "../../../app/place-editor.tsx"), "utf8");

describe("Settings detail (audit A8b)", () => {
  it("shows each Apple Health type as one row that opens its own sheet (UIA-085)", () => {
    const health = settings.slice(settings.indexOf("HEALTH_IMPORT_GROUPS.map((group) =>"), settings.indexOf("{healthDetailKey ? ("));
    expect(health).toContain("onPress={() => setHealthDetailKey(option.key)}");
    expect(health).toContain("`Logs as ${mappedCategory?.name ?? defaultHealthCategoryLabel(option.key)}`");
    // Logs as and Name live only in the type's sheet now.
    expect(health).not.toContain('title="Logs as"');
    expect(health).not.toContain("healthNameInput");
    const sheet = settings.slice(settings.indexOf("function HealthTypeSheet("), settings.indexOf("function LocationInformationSheet("));
    expect(sheet).toContain('title="Logs as"');
    expect(sheet).toContain("healthNameInput");
    expect(sheet).toContain('label="Use default"');
    // The picker opens over the type's sheet, inside it.
    expect(settings).toMatch(/<HealthTypeSheet[\s\S]*?<ActivityPickerSheet[\s\S]*?<\/HealthTypeSheet>/);
  });

  it("lifts the Apple Health type sheet through SwipeDismissSheet's keyboard hand-off, not a separate offset (Codex r1 on #355)", () => {
    const sheet = settings.slice(settings.indexOf("function HealthTypeSheet("), settings.indexOf("function LocationInformationSheet("));
    // The keyboard geometry is the shared one, handed to the sheet that owns translation.
    expect(sheet).toContain("keyboardInsetFromScreenY({");
    expect(sheet).toContain("keyboardInset={keyboardInset}");
    expect(sheet).toContain("onGestureStart={() => Keyboard.dismiss()}");
    expect(sheet).not.toContain("translateYOffset");
    expect(sheet).not.toContain("Animated.timing");
    // Content-sized: a max height (85 % via the shared layout), never a fixed height.
    expect(sheet).toContain("contentSizedSheetKeyboardLayout({ bottomInset, keyboardInset, windowHeight })");
    expect(sheet).toContain("style={[styles.activeEditSheet, { maxHeight: keyboardLayout.sheetMaxHeight }]}");
    expect(sheet).not.toMatch(/\{ height: Math\.round\(windowHeight/);
    expect(sheet).toContain("paddingBottom: keyboardLayout.contentPaddingBottom");
    // The keyboard's space grows on the keyboard's own duration, at once under Reduce Motion.
    expect(sheet).toContain("if (reduceMotion || duration === null) {");
    expect(sheet).toContain("keyboardSpace.value = nextInset;");
    expect(sheet).toContain("keyboardSpace.value = withTiming(");
    // Name is revealed once the keyboard settles, without animation under Reduce Motion.
    expect(sheet).toContain("scrollRef.current?.scrollToEnd({ animated: !reduceMotion });");
    expect(sheet).toContain('Keyboard.addListener("keyboardDidShow", frame(true))');
    expect(sheet).toContain("runOnJS(revealName)()");
    expect(sheet).toContain("ref={scrollRef}");
  });

  it("keeps a row's switch separate from the text that opens more", () => {
    expect(blocks).toContain("if (onPress && control) {");
    expect(blocks).toContain("rowPressArea:");
  });

  it("names a place's block and picks its radius from three sizes (UIA-088)", () => {
    expect(placeEditor).toContain(">Block name</Text>");
    expect(placeEditor).toContain('accessibilityLabel="Block name for visits here"');
    expect(placeEditor).toContain("options={PLACE_RADIUS_OPTIONS}");
    expect(placeEditor).toContain("Pick a size to change it.");
    expect(placeEditor).not.toContain('testID="place-editor-radius"');
  });

  it("restores a failed Health Name by draft version, never by matching text (Codex r9)", () => {
    expect(settings).toContain("token !== undefined && token === versionRef.current");
    expect(settings).toContain("versionRef.current = nextHealthNameDraftVersion();");
    expect(settings).toContain("healthMappingWriter.commitName(healthKey, draftRef.current, versionRef.current)");
    expect(settings).not.toContain("draftRef.current.trim() === failedName");
    // A restore lands on what the writer shows now (Codex r10), not blindly on the saved Name.
    expect(settings).toContain("setNameDraft(shown ? shown[healthKey]?.description ?? \"\" : savedName)");
  });
});
