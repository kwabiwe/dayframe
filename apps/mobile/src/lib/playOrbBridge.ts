import { useSyncExternalStore } from "react";

// The Play orb lives in two places: the coral view the Dashboard draws over the tab bar's trailing
// slot, and the native tab item underneath, which reserves that slot and is what VoiceOver reaches.
// The tabs layout cannot see Dashboard state, so this bridge carries the native item's presses to
// the Dashboard and the running state back to the item's label. It holds no other state.

type Listener = () => void;

let running = false;
let available = false;
const runningListeners = new Set<Listener>();
const tapListeners = new Set<Listener>();

export function setPlayOrbRunning(next: boolean) {
  if (running === next) return;
  running = next;
  for (const listener of runningListeners) listener();
}

export function usePlayOrbRunning() {
  return useSyncExternalStore(
    (listener) => {
      runningListeners.add(listener);
      return () => runningListeners.delete(listener);
    },
    () => running,
    () => running
  );
}

/** Whether the orb is offered at all (signed in, on a phone running iOS 26 or later). */
export function setPlayOrbAvailable(next: boolean) {
  if (available === next) return;
  available = next;
  for (const listener of runningListeners) listener();
}

export function usePlayOrbAvailable() {
  return useSyncExternalStore(
    (listener) => {
      runningListeners.add(listener);
      return () => runningListeners.delete(listener);
    },
    () => available,
    () => available
  );
}

/** The native item was activated (VoiceOver double-tap, Switch Control): do what a tap on the orb does. */
export function requestPlayOrbTap() {
  for (const listener of tapListeners) listener();
}

export function onPlayOrbTap(listener: Listener) {
  tapListeners.add(listener);
  return () => {
    tapListeners.delete(listener);
  };
}
