import { requireOptionalNativeModule } from "expo-modules-core";
import type {
  DayframeMotionActivityRecord,
  DayframeMotionAuthorizationStatus
} from "./src/DayframeMotionActivity.types";

type DayframeMotionActivityNativeModule = {
  isAvailable(): boolean;
  getAuthorizationStatus(): DayframeMotionAuthorizationStatus;
  requestAuthorization(): Promise<DayframeMotionAuthorizationStatus>;
  queryActivities(fromMs: number, toMs: number, limit: number): Promise<DayframeMotionActivityRecord[]>;
};

// Absent in Expo Go and unit tests: every function then reports "unavailable".
const nativeModule = requireOptionalNativeModule<DayframeMotionActivityNativeModule>("DayframeMotionActivity");

export const MAX_MOTION_RECORDS_PER_QUERY = 2_000;

export const isAvailable = () => nativeModule?.isAvailable() ?? false;

export function getAuthorizationStatus(): DayframeMotionAuthorizationStatus {
  if (!nativeModule?.isAvailable()) return "unavailable";
  return nativeModule.getAuthorizationStatus();
}

export function requestAuthorization(): Promise<DayframeMotionAuthorizationStatus> {
  return nativeModule?.requestAuthorization() ?? Promise.resolve("unavailable");
}

export function queryActivities(fromMs: number, toMs: number, limit = MAX_MOTION_RECORDS_PER_QUERY) {
  if (!nativeModule) return Promise.resolve([] as DayframeMotionActivityRecord[]);
  return nativeModule.queryActivities(fromMs, toMs, Math.max(1, Math.min(MAX_MOTION_RECORDS_PER_QUERY, limit)));
}

export type { DayframeMotionActivityRecord, DayframeMotionAuthorizationStatus };
