"use client";

import { useSyncExternalStore } from "react";

function subscribeToMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

function localDayStartMs() {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The viewer's local midnight today (null before hydration): the "?" asking window's anchor, checked each minute. */
export function useLocalDayStartMs() {
  return useSyncExternalStore(subscribeToMinute, localDayStartMs, () => null);
}

/** Whether a media query matches (false on the server, before hydration, and where matchMedia is missing). */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
      if (!list || typeof list.addEventListener !== "function") return () => undefined;
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => typeof window.matchMedia === "function" && Boolean(window.matchMedia(query)?.matches),
    () => false
  );
}
