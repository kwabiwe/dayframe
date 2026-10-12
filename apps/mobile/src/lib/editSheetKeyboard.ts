const DEFAULT_TOP_GAP = 18;
const DEFAULT_MIN_TOP_GAP = 32;
const DEFAULT_KEYBOARD_CONTENT_PADDING = 32;
const DEFAULT_CONTENT_PADDING = 18;
const DEFAULT_KEYBOARD_ANIMATION_DURATION = 260;
const MAX_KEYBOARD_ANIMATION_DURATION = 360;
const MIN_ANDROID_KEYBOARD_ANIMATION_DURATION = 120;
const IOS_INTERACTIVE_FRAME_DURATION = 16;

export type KeyboardInsetInput = {
  keyboardScreenY: number;
  screenHeight: number;
  windowHeight: number;
};

export type EditSheetKeyboardLayoutInput = {
  bottomInset: number;
  keyboardInset: number;
  topInset: number;
  windowHeight: number;
};

export type EditSheetKeyboardLayout = {
  bottomLift: number;
  contentPaddingBottom: number;
  keyboardOpen: boolean;
  sheetHeight: number | null;
  sheetMaxHeight: number;
  topSafeGap: number;
};

export type KeyboardLiftAnimationInput = {
  eventDuration?: number;
  platform: string;
};

export function keyboardInsetFromScreenY({
  keyboardScreenY,
  screenHeight,
  windowHeight
}: KeyboardInsetInput): number {
  const coordinateHeight = Math.max(screenHeight, windowHeight);
  return Math.max(0, coordinateHeight - keyboardScreenY);
}

export function editSheetKeyboardLayout({
  bottomInset: _bottomInset,
  keyboardInset,
  topInset,
  windowHeight
}: EditSheetKeyboardLayoutInput): EditSheetKeyboardLayout {
  const keyboardOpen = keyboardInset > 0;
  const topSafeGap = Math.max(topInset + DEFAULT_TOP_GAP, DEFAULT_MIN_TOP_GAP);
  const sheetMaxHeight = Math.max(0, windowHeight - topSafeGap);

  return {
    bottomLift: 0,
    contentPaddingBottom: keyboardOpen
      ? keyboardInset + DEFAULT_KEYBOARD_CONTENT_PADDING
      : DEFAULT_CONTENT_PADDING,
    keyboardOpen,
    sheetHeight: sheetMaxHeight,
    sheetMaxHeight,
    topSafeGap
  };
}

export function keyboardLiftAnimationDuration({
  eventDuration,
  platform
}: KeyboardLiftAnimationInput): number | null {
  const rawDuration = eventDuration ?? DEFAULT_KEYBOARD_ANIMATION_DURATION;
  if (platform === "ios" && rawDuration <= IOS_INTERACTIVE_FRAME_DURATION) return null;
  const clampedDuration = Math.min(rawDuration, MAX_KEYBOARD_ANIMATION_DURATION);
  if (platform === "ios") return Math.max(1, clampedDuration);
  return Math.max(MIN_ANDROID_KEYBOARD_ANIMATION_DURATION, clampedDuration);
}

export type ContentSizedSheetKeyboardInput = {
  bottomInset: number;
  keyboardInset: number;
  windowHeight: number;
};

export type ContentSizedSheetKeyboardLayout = {
  contentPaddingBottom: number;
  keyboardOpen: boolean;
  keyboardSpace: number;
  sheetMaxHeight: number;
};

const CONTENT_SIZED_SHEET_MAX_HEIGHT = 0.85;
const CONTENT_SIZED_SHEET_MIN_PADDING = 12;

/**
 * A sheet as tall as its rows (at most 85 % of the window). The keyboard is the sheet's own bottom
 * occlusion boundary: a keyboard-high space at the foot of the sheet keeps every row above it, so
 * the sheet grows upward inside the same 85 % cap and its scroll view (shrinking first) stays fully
 * visible. `SwipeDismissSheet` keeps owning translation and the keyboard hand-off from the same
 * `keyboardInset`. With the keyboard down the rows end at the bottom safe area.
 */
export function contentSizedSheetKeyboardLayout({
  bottomInset,
  keyboardInset,
  windowHeight
}: ContentSizedSheetKeyboardInput): ContentSizedSheetKeyboardLayout {
  const keyboardOpen = keyboardInset > 0.5;
  return {
    contentPaddingBottom: keyboardOpen
      ? CONTENT_SIZED_SHEET_MIN_PADDING
      : Math.max(bottomInset, CONTENT_SIZED_SHEET_MIN_PADDING) + 4,
    keyboardOpen,
    keyboardSpace: keyboardOpen ? keyboardInset : 0,
    sheetMaxHeight: Math.round(windowHeight * CONTENT_SIZED_SHEET_MAX_HEIGHT)
  };
}
