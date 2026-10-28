/**
 * The Calendar prototype (location v4 end state, owner 28 Oct 2026): real code behind a build-time switch, so the
 * owner can try it on staging data before it ships. Set `EXPO_PUBLIC_DAYFRAME_CALENDAR_PROTOTYPE=1` only for
 * Simulator and Dayframe Staging builds; production and TestFlight builds never set it.
 */
export const CALENDAR_PROTOTYPE = process.env.EXPO_PUBLIC_DAYFRAME_CALENDAR_PROTOTYPE === "1";

/** Remembered on this device: "Show all places" in Calendar › List. */
export const SHOW_ALL_PLACES_STORAGE_KEY = "dayframe.calendar.showAllPlaces";
