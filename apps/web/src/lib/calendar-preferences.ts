/** Remembered per device: "All places" in Calendar › List, and the wide web's "Places and trips" column. */
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
