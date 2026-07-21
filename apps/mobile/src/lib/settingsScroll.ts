export function clampSettingsScrollOffset(
  offsetY: number,
  contentHeight: number,
  viewportHeight: number
) {
  if (![offsetY, contentHeight, viewportHeight].every(Number.isFinite)) return 0;
  return Math.min(Math.max(0, offsetY), Math.max(0, contentHeight - viewportHeight));
}

export function settingsScrollNeedsClamp(
  offsetY: number,
  contentHeight: number,
  viewportHeight: number
) {
  return Math.abs(offsetY - clampSettingsScrollOffset(offsetY, contentHeight, viewportHeight)) > 0.5;
}
