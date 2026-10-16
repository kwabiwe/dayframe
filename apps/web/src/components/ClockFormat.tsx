"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  resolveClockFormat,
  systemClockFormat,
  type ClockFormat,
  type ClockFormatPreference
} from "@dayframe/shared";
import { SegmentedControl, SettingsRow } from "@/components/ui/Primitives";
import {
  CLOCK_FORMAT_CHANGE_EVENT,
  CLOCK_FORMAT_STORAGE_KEY,
  SERVER_DEFAULT_CLOCK_FORMAT,
  clockFormatCookie,
  clockFormatFromCookieHeader,
  readClockFormatPreference
} from "@/lib/clock-format";

/** The format the server drew this page in (from the cookie), so hydration matches it. */
const ServerClockFormatContext = createContext<ClockFormat>(SERVER_DEFAULT_CLOCK_FORMAT);

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function subscribeToClockFormat(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CLOCK_FORMAT_CHANGE_EVENT, callback);
  // A locale change (System) reaches the page as `languagechange`.
  window.addEventListener("languagechange", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CLOCK_FORMAT_CHANGE_EVENT, callback);
    window.removeEventListener("languagechange", callback);
  };
}

function getClockFormatPreference(): ClockFormatPreference {
  return readClockFormatPreference(browserStorage());
}

function getClockFormat(): ClockFormat {
  return resolveClockFormat(getClockFormatPreference(), systemClockFormat());
}

export function setClockFormatPreference(next: ClockFormatPreference) {
  const storage = browserStorage();
  try {
    if (next === "system") storage?.removeItem(CLOCK_FORMAT_STORAGE_KEY);
    else storage?.setItem(CLOCK_FORMAT_STORAGE_KEY, next);
  } catch {
    // Private windows can refuse storage; the choice then lasts for this page only.
  }
  window.dispatchEvent(new Event(CLOCK_FORMAT_CHANGE_EVENT));
}

/**
 * Every web clock time reads its format here. The server and the hydrating client both use the
 * cookie's format; right after hydration the browser's own choice takes over, and the provider
 * mirrors it into the cookie for the next server render.
 */
export function ClockFormatProvider({ children, serverFormat }: { children: ReactNode; serverFormat: ClockFormat | null }) {
  const initial = serverFormat ?? SERVER_DEFAULT_CLOCK_FORMAT;
  const format = useSyncExternalStore(subscribeToClockFormat, getClockFormat, () => initial);
  useEffect(() => {
    if (clockFormatFromCookieHeader(document.cookie) === format) return;
    document.cookie = clockFormatCookie(format, window.location.protocol === "https:");
  }, [format]);
  return <ServerClockFormatContext.Provider value={initial}>{children}</ServerClockFormatContext.Provider>;
}

/** This browser's clock format ("12h" or "24h") for formatting times of day. */
export function useClockFormat(): ClockFormat {
  const serverFormat = useContext(ServerClockFormatContext);
  return useSyncExternalStore(subscribeToClockFormat, getClockFormat, () => serverFormat);
}

const choices: Array<{ value: ClockFormatPreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "12h", label: "12-hour" },
  { value: "24h", label: "24-hour" }
];

/** Settings › Appearance › Time format. */
export function ClockFormatSettings() {
  const preference = useSyncExternalStore(subscribeToClockFormat, getClockFormatPreference, () => "system" as const);
  const format = useClockFormat();
  return (
    <SettingsRow
      className="settings-appearance-row"
      label="Time format"
      detail={preference === "system"
        ? `Follows this browser’s language (${format === "12h" ? "12-hour" : "24-hour"} now).`
        : `Shows ${format === "12h" ? "12-hour" : "24-hour"} times on this browser.`}
      action={(
        <SegmentedControl
          ariaLabel="Time format"
          options={choices}
          value={preference}
          onChange={setClockFormatPreference}
        />
      )}
    />
  );
}
