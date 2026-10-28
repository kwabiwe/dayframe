/**
 * The Calendar prototype (location v4 end state, owner 28 Oct 2026): real code behind a switch, so the owner
 * can try it on staging data before it ships. Available on staging Previews and local development only (never
 * production); on there unless the person turned it off with the "Prototype" pill (a cookie, so the server
 * render and the first paint agree).
 */
export const CALENDAR_PROTOTYPE_COOKIE = "dayframe_calendar_prototype";

export function calendarPrototypeAvailable() {
  return process.env.NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV === "staging" || process.env.NEXT_PUBLIC_DAYFRAME_CALENDAR_PROTOTYPE === "1";
}

export function calendarPrototypeOn(cookieValue: string | undefined) {
  return calendarPrototypeAvailable() && cookieValue !== "off";
}

/** Remembered per device: "Show all places" in the List, and the wide web's "Places and trips" column. */
export const SHOW_ALL_PLACES_STORAGE_KEY = "dayframe.calendar.showAllPlaces";
export const PLACES_COLUMN_STORAGE_KEY = "dayframe.calendar.placesColumn";

export function readStoredFlag(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    return value === "1" ? true : value === "0" ? false : fallback;
  } catch {
    return fallback;
  }
}

export function storeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Private windows and blocked storage: the choice lasts this visit only.
  }
}
