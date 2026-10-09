// When setup offers itself (owner decision 9 Oct 2026): right after someone signs in on this phone,
// once per account, and only when nothing is set up yet — no saved places, Apple Health not
// connected and location suggestions off. Existing setups skip it; Settings › Help ›
// "Set up Dayframe again" is always there.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { mobileAccountKey, type MobileAccountOwner } from "./mobileAccount";

const offeredKey = (owner: MobileAccountOwner) => `dayframe:onboarding-offered:v1:${mobileAccountKey(owner)}`;

export type SetupSignals = { savedPlaces: number; healthConnected: boolean; locationSuggestionsOn: boolean };

export function setupLooksDone(signals: SetupSignals) {
  return signals.savedPlaces > 0 || signals.healthConnected || signals.locationSuggestionsOn;
}

/**
 * True when setup should open now. Records the offer first, so it is never offered twice for the
 * same account on this phone, even if reading the signals fails.
 */
export async function claimOnboardingOffer(owner: MobileAccountOwner, readSignals: () => Promise<SetupSignals>) {
  const key = offeredKey(owner);
  if ((await AsyncStorage.getItem(key)) !== null) return false;
  await AsyncStorage.setItem(key, new Date().toISOString());
  try {
    return !setupLooksDone(await readSignals());
  } catch {
    return false;
  }
}
