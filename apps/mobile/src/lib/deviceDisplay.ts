import { useEffect, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import { useKeepAwake } from "expo-keep-awake";

const key = "dayframe.device-display.keep-awake.v1";
let keepAwake = false;
let load: Promise<void> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useKeepTodayAwake() {
  useEffect(() => {
    load ??= AsyncStorage.getItem(key).then((value) => {
      keepAwake = value === "true";
      listeners.forEach((listener) => listener());
    }).catch(() => { load = undefined; });
  }, []);
  return useSyncExternalStore(subscribe, () => keepAwake, () => false);
}

export async function setKeepTodayAwake(enabled: boolean) {
  if (load) await load;
  await AsyncStorage.setItem(key, String(enabled));
  keepAwake = enabled;
  listeners.forEach((listener) => listener());
}

export function KeepTodayAwake() {
  useKeepAwake("dayframe.today.recording", { suppressDeactivateWarnings: true });
  return null;
}

export function readLandscapeEnabled(): Promise<boolean> | undefined {
  return NativeModules.DayframeDeviceDisplay?.landscapeEnabled();
}

export function setLandscapeEnabled(enabled: boolean): Promise<void> | undefined {
  return NativeModules.DayframeDeviceDisplay?.setLandscapeEnabled(enabled);
}
