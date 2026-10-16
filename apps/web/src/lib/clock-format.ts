import { isClockFormatPreference, type ClockFormat, type ClockFormatPreference } from "@dayframe/shared";

/**
 * The web side of the per-device 12/24-hour setting (owner decision 16 Oct 2026). The choice
 * (System · 12-hour · 24-hour) lives in this browser's localStorage; System, the default, follows
 * the browser's own locale. The resolved format is mirrored into a first-party cookie only so the
 * server draws the first paint in the same format and hydration does not flip it; the cookie is
 * never the source of the choice.
 */
export const CLOCK_FORMAT_STORAGE_KEY = "dayframe.clockFormat";
export const CLOCK_FORMAT_CHANGE_EVENT = "dayframe-clock-format-change";
export const CLOCK_FORMAT_COOKIE = "dayframe_clock";
/** The server's format before this browser has told it (Dayframe's long-standing 24-hour clock). */
export const SERVER_DEFAULT_CLOCK_FORMAT: ClockFormat = "24h";

export function readClockFormatPreference(storage: Pick<Storage, "getItem"> | null | undefined): ClockFormatPreference {
  try {
    const stored = storage?.getItem(CLOCK_FORMAT_STORAGE_KEY);
    return isClockFormatPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** A validated format from the cookie value, or null. */
export function clockFormatFromCookieValue(value: unknown): ClockFormat | null {
  return value === "12h" || value === "24h" ? value : null;
}

/** The raw cookie value from a `Cookie` header or `document.cookie`. */
export function clockFormatFromCookieHeader(header: string | null | undefined): ClockFormat | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CLOCK_FORMAT_COOKIE) return clockFormatFromCookieValue(rest.join("="));
  }
  return null;
}

/** The cookie string (a year, first-party, Lax; `Secure` on HTTPS). */
export function clockFormatCookie(format: ClockFormat, secure = false) {
  return `${CLOCK_FORMAT_COOKIE}=${format}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
