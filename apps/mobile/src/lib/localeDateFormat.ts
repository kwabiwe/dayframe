// One Intl.DateTimeFormat per option set. Hermes builds a new formatter on every
// Date#toLocaleDateString call (about a millisecond on an iPhone 11), and the Reports and Calendar
// models format every day they show, so per-call formatting dominated idle re-renders
// (investigation 2026-10-12, Instruments run 2). Same output as toLocaleDateString(undefined, options).
const formatters = new Map<string, Intl.DateTimeFormat>();
const ZONE_RECHECK_MS = 1_000;
let zone: string | null = null;
let zoneCheckedAt = 0;

/**
 * The device's time zone identity, re-read at most once a second (reading it builds one formatter) and at
 * once after clearLocaleDateFormats, so a zone change while a screen is open shows on its first render a
 * second later, as per-call formatting did. `getTimezoneOffset` cannot detect it: Hermes caches the
 * offset (Codex r1 on #404). A formatter keeps the zone it was made in, so the zone is
 * part of every cache key: a zone change never reuses a formatter, even between zones that share an
 * offset but not daylight-saving rules.
 */
export function currentTimeZoneId(now = Date.now()): string {
  if (zone === null || now - zoneCheckedAt > ZONE_RECHECK_MS) {
    zone = new Intl.DateTimeFormat().resolvedOptions().timeZone ?? "local";
    zoneCheckedAt = now;
  }
  return zone;
}

/** The cached formatter for these options in the current zone (for `formatRange` and similar). */
export function localeDateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${currentTimeZoneId()}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, options);
    formatters.set(key, formatter);
  }
  return formatter;
}

export function formatLocaleDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return localeDateFormatter(options).format(date);
}

/** Called when the app returns to the foreground: the device time zone or language may have changed. */
export function clearLocaleDateFormats() {
  formatters.clear();
  zone = null;
}
