/**
 * The Calendar nav's tap (sidebar and phone tab bar): Calendar opens on today (owner bug, 29 Oct 2026). When the URL
 * already names today, `/timeline` canonicalises to the same route and Next keeps the page, so the link alone asks for
 * nothing; this event is the fresh "go to today" request the Calendar reads every time (Codex r2 on #625).
 */
export const CALENDAR_TODAY_EVENT = "dayframe:calendar-today";

export function requestCalendarToday() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CALENDAR_TODAY_EVENT));
}

export function subscribeToCalendarToday(listener: () => void) {
  window.addEventListener(CALENDAR_TODAY_EVENT, listener);
  return () => window.removeEventListener(CALENDAR_TODAY_EVENT, listener);
}
