import type { EventSource } from "@dayframe/shared";
import { mobileAccountKey, type MobileAccountOwner } from "../mobileAccount";

let pausedOwner: string | null = null;
const listeners = new Set<() => void>();

export function isLegacyAutomaticLocationSource(source: EventSource) {
  return source === "geofence_specific" || source === "geofence_broad" || source === "location_learning";
}

export function isAutomaticLocationTransferPaused(owner: MobileAccountOwner) {
  return pausedOwner === mobileAccountKey(owner);
}

export function isPausedLegacyLocationEvent(event: MobileAccountOwner & { source: EventSource }) {
  return isLegacyAutomaticLocationSource(event.source) && isAutomaticLocationTransferPaused(event);
}

/** A pause affects scheduling only. The durable queues retain every item. */
export function setAutomaticLocationTransferPaused(owner: MobileAccountOwner, paused: boolean) {
  const key = mobileAccountKey(owner);
  if (paused ? pausedOwner === key : pausedOwner !== key) return;
  pausedOwner = paused ? key : null;
  for (const listener of listeners) listener();
}

export function subscribeAutomaticLocationTransferPause(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
