/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(
  fileURLToPath(new URL("../../app/settings.tsx", import.meta.url)),
  "utf8"
);

describe("mobile Categories creation contract", () => {
  it("keeps the focused creator in a keyboard-adjusted scroll viewport", () => {
    expect(settingsSource).toContain('automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}');
    expect(settingsSource).toContain('keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}');
    expect(settingsSource).toContain('Keyboard.addListener("keyboardDidShow", revealFocusedEditor)');
    expect(settingsSource).toContain("settingsScrollRef.current?.scrollToEnd");
    expect(settingsSource).toContain("scrollResponderScrollNativeHandleToKeyboard");
    expect(settingsSource).toContain("CATEGORY_EDITOR_KEYBOARD_CLEARANCE = 360");
    expect(settingsSource.match(/placeholder="New category"/g)).toHaveLength(1);
  });

  it("offers the shared 12-colour picker before creating a category", () => {
    expect(settingsSource.match(/<CategoryColorPicker/g)).toHaveLength(2);
    expect(settingsSource).toContain("selectedColor={newCategoryColor}");
    expect(settingsSource).toContain("color: newCategoryColor");
    expect(settingsSource).toContain('accessibilityLabel="Category colour"');
  });

  it("uses one local owner for creator presence and surrounding layout", () => {
    expect(settingsSource).toContain("layout={localLayoutTransition(reduceMotion)}");
    expect(settingsSource).toContain("entering={localPresenceEntering(reduceMotion)}");
    expect(settingsSource).toContain("exiting={localPresenceExiting(reduceMotion)}");
  });
});
