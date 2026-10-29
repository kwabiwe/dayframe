/**
 * The Calendar nav's tap (sidebar and phone tab bar): Calendar opens on today (owner bug, 29 Oct 2026). When the URL
 * already names today, `/timeline` canonicalises to the same route and Next keeps the page, so the link alone asks for
 * nothing; this event is the fresh "go to today" request the Calendar reads every time (Codex r2 on #625).
 */
export const CALENDAR_TODAY_EVENT = "dayframe:calendar-today";

/**
 * The Calendar's date-navigation generation (Codex r3 and r4 on #625): every tap starts a new one. Each path that changes
 * the Calendar's date after loading its period — the week strip, the picker, ‹ ›, Today, Alt+← / Alt+→ — captures it
 * before its load and drops its navigation when it changed meanwhile, so a late load never overrides the tap.
 */
let navigationGeneration = 0;

export function calendarNavigationGeneration() {
  return navigationGeneration;
}

export function requestCalendarToday() {
  navigationGeneration += 1;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CALENDAR_TODAY_EVENT));
}

export function subscribeToCalendarToday(listener: () => void) {
  window.addEventListener(CALENDAR_TODAY_EVENT, listener);
  return () => window.removeEventListener(CALENDAR_TODAY_EVENT, listener);
}
