// One Intl.DateTimeFormat per option set. Hermes builds a new formatter on every
// Date#toLocaleDateString call (about a millisecond on an iPhone 11), and the Reports and Calendar
// models format every day they show, so per-call formatting dominated idle re-renders
// (investigation 2026-10-12, Instruments run 2). Same output as toLocaleDateString(undefined, options).
const formatters = new Map<string, Intl.DateTimeFormat>();

export function formatLocaleDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  // A formatter keeps the zone it was made in: the date's UTC offset is part of the key, and the
  // cache is cleared when the app returns to the foreground (a zone change while away).
  const key = `${date.getTimezoneOffset()}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, options);
    formatters.set(key, formatter);
  }
  return formatter.format(date);
}

/** Called when the app returns to the foreground: the device time zone or language may have changed. */
export function clearLocaleDateFormats() {
  formatters.clear();
}
