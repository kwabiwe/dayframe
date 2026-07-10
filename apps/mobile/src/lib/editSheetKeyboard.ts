const DEFAULT_TOP_GAP = 18;
const DEFAULT_MIN_TOP_GAP = 32;
const DEFAULT_KEYBOARD_CONTENT_PADDING = 96;
const DEFAULT_CONTENT_PADDING = 18;

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
  topSafeGap: number;
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

  return {
    bottomLift,
    contentPaddingBottom: keyboardOpen ? DEFAULT_KEYBOARD_CONTENT_PADDING : DEFAULT_CONTENT_PADDING,
    keyboardOpen,
    sheetHeight: keyboardOpen ? availableHeight : null,
    topSafeGap
  };
}
