"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CALENDAR_PROTOTYPE_COOKIE, calendarPrototypeAvailable } from "@/lib/calendar-prototype";

const CalendarPrototypeContext = createContext(false);

export function CalendarPrototypeProvider({ children, on }: { children: ReactNode; on: boolean }) {
  return <CalendarPrototypeContext.Provider value={on}>{children}</CalendarPrototypeContext.Provider>;
}

/** Whether the Calendar prototype is on for this visit. */
export function useCalendarPrototype() {
  return useContext(CalendarPrototypeContext);
}

/** The "Prototype" pill: on staging, turns the prototype off (or back on) to compare with what ships today. */
export function CalendarPrototypePill() {
  const on = useCalendarPrototype();
  const router = useRouter();
  if (!calendarPrototypeAvailable()) return null;
  return (
    <button
      aria-pressed={on}
      className={`calendar-prototype-pill${on ? " is-on" : ""}`}
      data-tip={on ? "Showing the new Calendar. Press to see today's." : "Showing today's Calendar. Press to see the new one."}
      onClick={() => {
        document.cookie = `${CALENDAR_PROTOTYPE_COOKIE}=${on ? "off" : "on"}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      type="button"
    >
      {on ? "Prototype on" : "Prototype off"}
    </button>
  );
}

/** A visible "not real yet" label for a part of the prototype that can't work yet. */
export function NotRealYet({ children }: { children: ReactNode }) {
  return <span className="calendar-prototype-not-real">Not real yet: {children}</span>;
}

function subscribeToMinute(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

function localDayStartMs() {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The viewer's local midnight today (null before hydration): the asking window's anchor, checked each minute. */
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
