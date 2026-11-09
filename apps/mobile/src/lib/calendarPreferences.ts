import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";

/** Remembered on this device: "All places" in Calendar › List (owner, 28 Oct 2026, concern 3). */
const SHOW_ALL_PLACES_STORAGE_KEY = "dayframe.calendar.showAllPlaces";
// Match the initial Calendar timeline budget. A stalled device read cannot hold the day's blocks.
const PLACE_FILTER_WAIT_MS = 800;

/** The Calendar owner stays mounted across Grid and List. Read before painting real List rows. */
export function useCalendarPlaceFilter() {
  const [showAllPlaces, setShowAllPlaces] = useState<boolean | null>(null);
  const currentChoice = useRef<boolean | null>(null);

  useEffect(() => {
    if (showAllPlaces !== null) return;
    let live = true;
    const settle = (stored: string | null) => {
      clearTimeout(timeout);
      if (!live || currentChoice.current !== null) return;
      currentChoice.current = stored === "1";
      setShowAllPlaces(currentChoice.current);
    };
    const timeout = setTimeout(() => settle(null), PLACE_FILTER_WAIT_MS);
    void AsyncStorage.getItem(SHOW_ALL_PLACES_STORAGE_KEY).then(settle, () => settle(null));
    return () => {
      live = false;
      clearTimeout(timeout);
    };
  }, [showAllPlaces]);

  const onToggleShowAllPlaces = useCallback(() => {
    const next = !currentChoice.current;
    currentChoice.current = next;
    setShowAllPlaces(next);
    void AsyncStorage.setItem(SHOW_ALL_PLACES_STORAGE_KEY, next ? "1" : "0").catch(() => undefined);
  }, []);

  return { showAllPlaces, onToggleShowAllPlaces };
}
