/**
 * The viewer's IANA time zone for server-rendered web pages.
 *
 * Vercel renders in UTC, so anything the server works out in "local" time (a report's days, the
 * Calendar's default date) would use UTC rather than the viewer's zone. The app shell stores the
 * browser's zone in a first-party cookie; server code reads it through `normalizeViewerTimeZone`,
 * which accepts only a zone this runtime knows and falls back to UTC.
 *
 * Web only: the iPhone app never sends this cookie, so the API it uses keeps its behaviour.
 */
export const VIEWER_TIME_ZONE_COOKIE = "dayframe_tz";
export const FALLBACK_TIME_ZONE = "UTC";

const ZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** A canonical IANA zone name for a cookie value, or UTC when it is missing or unknown. */
export function normalizeViewerTimeZone(value: unknown): string {
  if (typeof value !== "string") return FALLBACK_TIME_ZONE;
  const candidate = value.trim();
  if (!ZONE_PATTERN.test(candidate)) return FALLBACK_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).resolvedOptions().timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/** The browser's own zone, for the cookie (client only). */
export function browserTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && ZONE_PATTERN.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * The cookie string the app shell writes (a year, first-party, Lax; `Secure` on HTTPS, left off
 * for plain-HTTP local development). A zone name only holds characters a cookie value allows, so
 * it is written as it is.
 */
export function viewerTimeZoneCookie(zone: string, secure = false) {
  return `${VIEWER_TIME_ZONE_COOKIE}=${zone}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The raw zone from a `Cookie` header or `document.cookie`; validate it before use. */
export function viewerTimeZoneFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VIEWER_TIME_ZONE_COOKIE) return rest.join("=");
  }
  return null;
}

type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function zonedParts(ms: number, timeZone: string): ZonedParts {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
    partsFormatters.set(timeZone, formatter);
  }
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second
  };
}

function keyFromParts(parts: Pick<ZonedParts, "year" | "month" | "day">) {
  return `${parts.year}-${`${parts.month}`.padStart(2, "0")}-${`${parts.day}`.padStart(2, "0")}`;
}

/** The calendar date ("2026-10-12") an instant falls on in a zone. */
export function zonedDateKey(instant: Date | number, timeZone: string) {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  return keyFromParts(zonedParts(ms, timeZone));
}

/** How far the zone's wall clock is ahead of UTC at an instant, in milliseconds. */
function zonedOffsetMs(ms: number, timeZone: string) {
  const parts = zonedParts(ms, timeZone);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * The first instant of a calendar date in a zone: its midnight, or, where the clocks skip
 * midnight, the moment the day begins. Accepts only a valid "YYYY-MM-DD" key.
 */
export function zonedStartOfDay(dateKey: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const hour = 3_600_000;
  // A day's offset can only be one of those in force around it; try each and keep the earliest
  // candidate that falls on the day itself.
  const offsets = new Set([wall - 36 * hour, wall, wall + 36 * hour].map((probe) => zonedOffsetMs(probe, timeZone)));
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((candidate) => zonedDateKey(candidate, timeZone) === dateKey)
    .sort((left, right) => left - right);
  return new Date(candidates[0] ?? wall);
}

/** The date key `days` after (or before) another, in plain calendar arithmetic. */
export function addDaysToDateKey(dateKey: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

/** The Monday on or before a date key (the app's weeks start on Monday). */
export function mondayOfDateKey(dateKey: string) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return addDaysToDateKey(dateKey, weekday === 0 ? -6 : 1 - weekday);
}

/**
 * The instant a date's wall clock reads `hour`:00 in a zone; where the clocks skip that hour, the
 * first instant after the gap.
 */
export function zonedWallHour(dateKey: string, hour: number, timeZone: string): Date {
  if (hour <= 0) return zonedStartOfDay(dateKey, timeZone);
  if (hour >= 24) return zonedStartOfDay(addDaysToDateKey(dateKey, 1), timeZone);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`Invalid date key: ${dateKey}`);
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour);
  const span = 36 * 3_600_000;
  const offsets = new Set([wall - span, wall, wall + span].map((probe) => zonedOffsetMs(probe, timeZone)));
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((candidate) => {
      const parts = zonedParts(candidate, timeZone);
      return keyFromParts(parts) === dateKey && parts.hour >= hour;
    })
    .sort((left, right) => left - right);
  return new Date(candidates[0] ?? wall);
}

/**
 * Whether a bootstrap snapshot's ranges were built for the zone a browser with this cookie header
 * sends now: the web runtime reuses a cached day only then (Codex r1 on #484). A snapshot without
 * a zone used the server's midnights and fits only a browser that sends none.
 */
export function snapshotFitsViewerZone(snapshotZone: string | null | undefined, cookieHeader: string | null | undefined) {
  const sent = viewerTimeZoneFromCookieHeader(cookieHeader);
  return (snapshotZone ?? null) === (sent ? normalizeViewerTimeZone(sent) : null);
}

/**
 * Writes the browser's zone to the cookie when it is missing or different (client only).
 * Returns true when it changed, so a page the server drew for another zone can redraw.
 */
export function syncViewerTimeZoneCookie(doc: Pick<Document, "cookie">, secure = false): boolean {
  const zone = browserTimeZone();
  if (!zone || viewerTimeZoneFromCookieHeader(doc.cookie) === zone) return false;
  doc.cookie = viewerTimeZoneCookie(zone, secure);
  return true;
}
