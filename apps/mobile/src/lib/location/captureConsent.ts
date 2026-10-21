import AsyncStorage from "@react-native-async-storage/async-storage";
import { DAYFRAME_API_BASE } from "../config";
import { mobileAccountKey, type MobileAccountOwner } from "../mobileAccount";

export const LOCATION_LEARNING_ENABLED_KEY = "dayframe.location.learning.enabled.v1";

export function locationAccountStorageKey(key: string, ownerKey: string) {
  return `${key}:account:${encodeURIComponent(DAYFRAME_API_BASE)}:${ownerKey}`;
}

// Local consent only. Capture must keep working offline and with locked Keychain.
export async function readLocationCaptureConsent(owner: MobileAccountOwner) {
  return await AsyncStorage.getItem(locationAccountStorageKey(LOCATION_LEARNING_ENABLED_KEY, mobileAccountKey(owner))) === "true";
}

type ConsentListener = (owner: MobileAccountOwner, enabled: boolean) => void;
const consentListeners = new Set<ConsentListener>();

/** Hears every consent write (the tracking-stopped notice keeps its armed flag current with it). */
export function subscribeLocationCaptureConsent(listener: ConsentListener) {
  consentListeners.add(listener);
  return () => {
    consentListeners.delete(listener);
  };
}

function announceConsent(owner: MobileAccountOwner, enabled: boolean) {
  for (const listener of consentListeners) {
    try {
      listener(owner, enabled);
    } catch {
      // A listener never blocks the consent write.
    }
  }
}

export async function writeLocationCaptureConsent(owner: MobileAccountOwner, enabled: boolean) {
  // Off is announced before it is stored, so dependants stand down first; on only once stored.
  if (!enabled) announceConsent(owner, false);
  await AsyncStorage.setItem(locationAccountStorageKey(LOCATION_LEARNING_ENABLED_KEY, mobileAccountKey(owner)), String(enabled));
  if (enabled) announceConsent(owner, true);
}
