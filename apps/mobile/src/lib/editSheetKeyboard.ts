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
  bottomInset,
  keyboardInset,
  topInset,
  windowHeight
}: EditSheetKeyboardLayoutInput): EditSheetKeyboardLayout {
  const keyboardOpen = keyboardInset > 0;
  const bottomLift = keyboardOpen ? Math.max(0, keyboardInset - bottomInset) : 0;
  const topSafeGap = Math.max(topInset + DEFAULT_TOP_GAP, DEFAULT_MIN_TOP_GAP);
  const availableHeight = Math.max(0, windowHeight - topSafeGap - bottomLift);
  const sheetMaxHeight = Math.max(0, windowHeight - topSafeGap);

  return {
    bottomLift,
    contentPaddingBottom: keyboardOpen ? DEFAULT_KEYBOARD_CONTENT_PADDING : DEFAULT_CONTENT_PADDING,
    keyboardOpen,
    sheetHeight: keyboardOpen ? availableHeight : null,
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
