import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import {
  isClockFormatPreference,
  resolveClockFormat,
  type ClockFormat,
  type ClockFormatPreference
} from "@dayframe/shared";

/**
 * The iPhone's per-device 12/24-hour time format (owner decision 16 Oct 2026, PRD D18): System ·
 * 12-hour · 24-hour, kept on this phone (not the account). System, the default, follows the
 * iPhone's own 24-Hour Time setting, which the root layout reads through the time-wheel native
 * module and refreshes whenever the app comes back to the foreground. Every clock time of day
 * reads its format with `useClockFormat()` and formats with the shared `formatClock*` helpers.
 */
export const CLOCK_FORMAT_PREFERENCE_KEY = "dayframe.clockFormat.v1";

let preference: ClockFormatPreference = "system";
let systemFormat: ClockFormat | null = null;
let systemReader: (() => ClockFormat | null) | null = null;
let preferenceLoad: Promise<ClockFormatPreference> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function currentSystemFormat(): ClockFormat {
  systemFormat ??= readSystemFormat();
  return systemFormat;
}

/**
 * The iPhone's setting as the native reader reports it. Without one (tests, or a build without the
 * native function) Dayframe keeps its long-standing 24-hour clock rather than guessing from the
 * JavaScript locale, which does not reflect the iPhone's 24-Hour Time switch.
 */
function readSystemFormat(): ClockFormat {
  try {
    const native = systemReader?.();
    if (native) return native;
  } catch {
    // Fall back below.
  }
  return "24h";
}

/** The root layout hands over the native 24-Hour Time reader once, before any screen renders. */
export function registerSystemClockFormatReader(reader: () => ClockFormat | null) {
  systemReader = reader;
  refreshSystemClockFormat();
}

/** Re-reads the iPhone's setting (the app returned to the foreground); only a change re-renders. */
export function refreshSystemClockFormat() {
  const next = readSystemFormat();
  if (next === systemFormat) return;
  systemFormat = next;
  emit();
}

export function loadClockFormatPreference() {
  preferenceLoad ??= AsyncStorage.getItem(CLOCK_FORMAT_PREFERENCE_KEY)
    .then((value) => {
      const next = isClockFormatPreference(value) ? value : "system";
      if (next !== preference) {
        preference = next;
        emit();
      }
      return preference;
    })
    .catch(() => preference);
  return preferenceLoad;
}

export async function setClockFormatPreference(next: ClockFormatPreference) {
  preferenceLoad = Promise.resolve(next);
  if (next !== preference) {
    preference = next;
    emit();
  }
  await AsyncStorage.setItem(CLOCK_FORMAT_PREFERENCE_KEY, next);
}

export function getClockFormatPreference(): ClockFormatPreference {
  return preference;
}

export function getClockFormat(): ClockFormat {
  return resolveClockFormat(preference, currentSystemFormat());
}

/** Calls `listener` whenever the resolved format or the stored choice may have changed. */
export function subscribeToClockFormat(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** This phone's clock format ("12h" or "24h") for every clock time of day. */
export function useClockFormat(): ClockFormat {
  return useSyncExternalStore(subscribeToClockFormat, getClockFormat, getClockFormat);
}

/** The stored choice, for Settings › Appearance › Time format. */
export function useClockFormatPreference(): ClockFormatPreference {
  return useSyncExternalStore(subscribeToClockFormat, getClockFormatPreference, getClockFormatPreference);
}

/** Test helper: back to the defaults with nothing loaded. */
export function resetClockFormatForTests() {
  preference = "system";
  systemFormat = null;
  systemReader = null;
  preferenceLoad = null;
  listeners.clear();
}
