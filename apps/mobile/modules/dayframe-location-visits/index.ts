import { requireNativeModule } from "expo-modules-core";
import type {
  DayframeLocationNativeSignal,
  DayframeLocationNativeStatus
} from "./src/DayframeLocationVisits.types";

type DayframeLocationVisitsModule = {
  startMonitoring(): Promise<DayframeLocationNativeStatus>;
  stopMonitoring(): Promise<DayframeLocationNativeStatus>;
  getStatus(): Promise<DayframeLocationNativeStatus>;
  drainSignals(limit: number): Promise<DayframeLocationNativeSignal[]>;
  clearSignals(ids: string[]): Promise<number>;
  clearAllSignals(): Promise<number>;
};

const nativeModule = requireNativeModule<DayframeLocationVisitsModule>("DayframeLocationVisits");

export const startMonitoring = () => nativeModule.startMonitoring();
export const stopMonitoring = () => nativeModule.stopMonitoring();
export const getStatus = () => nativeModule.getStatus();
export const drainSignals = (limit = 100) => nativeModule.drainSignals(Math.max(1, Math.min(100, limit)));
export const clearSignals = (ids: string[]) => nativeModule.clearSignals(ids.slice(0, 100));
export const clearAllSignals = () => nativeModule.clearAllSignals();

export type { DayframeLocationNativeSignal, DayframeLocationNativeStatus };
