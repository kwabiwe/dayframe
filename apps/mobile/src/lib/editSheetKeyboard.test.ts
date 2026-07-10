import { describe, expect, it } from "vitest";
import { editSheetKeyboardLayout, keyboardInsetFromScreenY } from "./editSheetKeyboard";

describe("edit sheet keyboard layout", () => {
  it("uses the larger screen coordinate space for keyboard frames", () => {
    expect(keyboardInsetFromScreenY({
      keyboardScreenY: 520,
      screenHeight: 852,
      windowHeight: 780
    })).toBe(332);
  });

  it("keeps the sheet above the keyboard on a small iPhone viewport", () => {
    const layout = editSheetKeyboardLayout({
      bottomInset: 0,
      keyboardInset: 301,
      topInset: 20,
      windowHeight: 667
    });

    expect(layout).toEqual({
      bottomLift: 301,
      contentPaddingBottom: 96,
      keyboardOpen: true,
      sheetHeight: 328,
      topSafeGap: 38
    });
    expect(layout.sheetHeight! + layout.bottomLift).toBeLessThanOrEqual(667 - layout.topSafeGap);
  });

  it("does not double count the bottom safe area when lifting above the keyboard", () => {
    const layout = editSheetKeyboardLayout({
      bottomInset: 34,
      keyboardInset: 336,
      topInset: 47,
      windowHeight: 844
    });

    expect(layout.bottomLift).toBe(302);
    expect(layout.sheetHeight).toBe(477);
    expect(layout.topSafeGap).toBe(65);
  });

  it("leaves normal bottom-sheet layout alone when the keyboard is closed", () => {
    expect(editSheetKeyboardLayout({
      bottomInset: 34,
      keyboardInset: 0,
      topInset: 47,
      windowHeight: 844
    })).toEqual({
      bottomLift: 0,
      contentPaddingBottom: 18,
      keyboardOpen: false,
      sheetHeight: null,
      topSafeGap: 65
    });
  });
});
