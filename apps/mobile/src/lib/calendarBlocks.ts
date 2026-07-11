export const CALENDAR_BLOCK_MIN_VISIBLE_HEIGHT = 4;
export const CALENDAR_BLOCK_TITLE_MIN_HEIGHT = 38;
export const CALENDAR_BLOCK_META_MIN_HEIGHT = 58;

export function calendarVisibleBlockHeight(durationMinutes: number, hourHeight: number) {
  const rawHeight = (Math.max(1, durationMinutes) / 60) * hourHeight;
  return Math.max(CALENDAR_BLOCK_MIN_VISIBLE_HEIGHT, rawHeight);
}

export function calendarBlockPresentation(height: number) {
  return {
    showTitle: height >= CALENDAR_BLOCK_TITLE_MIN_HEIGHT,
    showMeta: height >= CALENDAR_BLOCK_META_MIN_HEIGHT,
    tiny: height < CALENDAR_BLOCK_TITLE_MIN_HEIGHT,
    compact: height < CALENDAR_BLOCK_META_MIN_HEIGHT
  };
}
