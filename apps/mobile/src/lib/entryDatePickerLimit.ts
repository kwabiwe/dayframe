/**
 * The latest day the entry sheet's date sheet offers: today, for a running block's start and for a
 * finished block's start and end alike (owner decision D2, 14 Oct 2026, replacing UIA-011's open
 * finished-block days). Add past time's later days were offered but rejected by the server.
 */
export function entryDatePickerMaxDate(now: Date): Date {
  return now;
}
