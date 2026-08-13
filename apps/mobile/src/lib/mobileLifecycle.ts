export const CALENDAR_FOREGROUND_RESET_AFTER_MS = 15 * 60 * 1000;

export function shouldResetCalendarToTodayOnForeground(input: {
  backgroundedAt: number | null;
  backgroundedDayKey: string | null;
  resumedAt: number;
  selectedDayKey: string;
  todayKey: string;
  resetAfterMs?: number;
}) {
  if (input.selectedDayKey === input.todayKey || input.backgroundedAt == null) return false;
  if (input.backgroundedDayKey && input.backgroundedDayKey !== input.todayKey) return true;
  return input.resumedAt - input.backgroundedAt >=
    (input.resetAfterMs ?? CALENDAR_FOREGROUND_RESET_AFTER_MS);
}

export function shouldDismissExternallyStoppedActiveEditor(input: {
  activeEntryId: string | null;
  presentationId: number | null;
  presentedEntryId: string | null;
  timerMutationsInFlight: number;
}) {
  return input.activeEntryId == null &&
    input.presentationId != null &&
    input.presentedEntryId != null &&
    input.timerMutationsInFlight === 0;
}
