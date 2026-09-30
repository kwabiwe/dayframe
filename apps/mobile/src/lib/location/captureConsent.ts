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

export function writeLocationCaptureConsent(owner: MobileAccountOwner, enabled: boolean) {
  return AsyncStorage.setItem(locationAccountStorageKey(LOCATION_LEARNING_ENABLED_KEY, mobileAccountKey(owner)), String(enabled));
}
