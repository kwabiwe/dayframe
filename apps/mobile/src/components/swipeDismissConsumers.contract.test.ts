import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const sheetSource = read("./SwipeDismissSheet.tsx");
const editSource = read("./ActiveTimerEditSheet.tsx");
const placesSource = read("../../app/places.tsx");
const settingsSource = read("../../app/settings.tsx");
const consumerSources = [editSource, placesSource, settingsSource];

describe("shared swipe-dismiss ownership integration", () => {
  it("uses no native slide animation around a shared custom transition", () => {
    for (const source of consumerSources) {
      expect(source).not.toMatch(/animationType=.*slide/);
      expect(source).toContain('animationType="none"');
    }
  });

  it("keeps the backdrop inside the shared transition owner", () => {
    expect(sheetSource).toContain("backdropProgressForTranslation");
    expect(sheetSource).toContain("onPress={requestDismiss}");
    for (const source of consumerSources) {
      expect(source).toContain("backdropStyle={styles.sheetBackdrop}");
    }
  });

  it("routes Done and successful destructive actions through coordinated exit", () => {
    expect(editSource).toContain("if (ok) sheetRef.current?.dismiss()");
    expect(editSource).not.toContain("if (ok) onCancel()");
  });

  it("does not reset drag translation before the dismissal callback", () => {
    expect(sheetSource).not.toContain("translationY.value = 0;\n      runOnJS(finishDismiss)");
    expect(sheetSource).not.toContain("dragY.setValue(0)");
  });

  it("separates keyboard lift from the Reanimated swipe transform", () => {
    expect(sheetSource).toContain("<ReactNativeAnimated.View");
    expect(sheetSource).toContain("<Reanimated.View");
    expect(editSource).toContain("onGestureStart={freezeKeyboardMotion}");
    expect(editSource).toContain("onGestureSettled={releaseKeyboardMotion}");
  });
});
