/**
 * The latest day the entry sheet's date picker offers (UIA-011). A running block can't start in
 * the future, so its start stops at today; a finished block may end after today (an overnight
 * block edited before midnight) and its start may follow, so those stay open, as the API allows.
 */
export function entryDatePickerMaxDate(input: {
  running: boolean;
  target: "start" | "end";
  now: Date;
}): Date | null {
  return input.running && input.target === "start" ? input.now : null;
}
