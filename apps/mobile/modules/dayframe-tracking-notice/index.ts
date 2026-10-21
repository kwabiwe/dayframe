import { requireOptionalNativeModule, NativeModule } from "expo-modules-core";

export type DayframeTrackingNoticeStatus = {
  armed: boolean;
  lastNoticeAt?: number;
  lastTerminationAt?: number;
};

declare class DayframeTrackingNoticeNativeModule extends NativeModule {
  setArmed(armed: boolean): Promise<void>;
  getStatus(): Promise<DayframeTrackingNoticeStatus>;
}

const nativeModule = requireOptionalNativeModule<DayframeTrackingNoticeNativeModule>(
  "DayframeTrackingNotice"
);

export const isAvailable = () => nativeModule !== null;

export const setArmed = (armed: boolean) => nativeModule?.setArmed(armed) ?? Promise.resolve();

export const getStatus = () => nativeModule?.getStatus() ?? Promise.resolve(null);
