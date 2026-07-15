import { describe, expect, it } from "vitest";
import {
  editSheetKeyboardLayout,
  keyboardInsetFromScreenY,
  keyboardLiftAnimationDuration
} from "./editSheetKeyboard";

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
      contentPaddingBottom: 32,
      keyboardOpen: true,
      sheetMaxHeight: 629,
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
    expect(layout.contentPaddingBottom).toBe(32);
    expect(layout.sheetMaxHeight).toBe(779);
    expect(layout.sheetHeight).toBe(477);
    expect(layout.topSafeGap).toBe(65);
  });

  it("caps the closed sheet below the Dynamic Island safe area", () => {
    const layout = editSheetKeyboardLayout({
      bottomInset: 34,
      keyboardInset: 0,
      topInset: 59,
      windowHeight: 852
    });

    expect(layout.topSafeGap).toBe(77);
    expect(layout.sheetMaxHeight).toBe(775);
    expect(layout.sheetHeight).toBeNull();
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
      sheetMaxHeight: 779,
      sheetHeight: null,
      topSafeGap: 65
    });
  });

  it("does not lag behind interactive iOS keyboard frames", () => {
    expect(keyboardLiftAnimationDuration({
      eventDuration: 0,
      platform: "ios"
    })).toBeNull();
    expect(keyboardLiftAnimationDuration({
      eventDuration: 250,
      platform: "ios"
    })).toBe(250);
  });

  it("keeps a minimum Android keyboard lift animation duration", () => {
    expect(keyboardLiftAnimationDuration({
      eventDuration: 0,
      platform: "android"
    })).toBe(120);
  });
});
