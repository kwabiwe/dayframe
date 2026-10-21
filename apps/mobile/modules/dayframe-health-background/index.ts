import {
  NativeModule,
  requireOptionalNativeModule,
  type EventSubscription
} from "expo-modules-core";

export type DayframeHealthWake = {
  id: string;
  kind: "sleep" | "workout" | "all";
  reason: "observer" | "refresh";
  receivedAt: number;
};

export type DayframeHealthBackgroundStatus = {
  enabled: boolean;
  observing: boolean;
  outstandingWakes: number;
  refreshRegistered: boolean;
};

type DayframeHealthBackgroundEvents = {
  onWake(wake: DayframeHealthWake): void;
};

declare class DayframeHealthBackgroundNativeModule extends NativeModule<
  DayframeHealthBackgroundEvents
> {
  setEnabled(enabled: boolean): Promise<boolean>;
  startListening(): Promise<DayframeHealthWake[]>;
  complete(id: string, success: boolean): Promise<boolean>;
  getStatus(): Promise<DayframeHealthBackgroundStatus>;
}

const nativeModule = requireOptionalNativeModule<DayframeHealthBackgroundNativeModule>(
  "DayframeHealthBackground"
);

export const isAvailable = () => nativeModule !== null;

export const setEnabled = (enabled: boolean) =>
  nativeModule?.setEnabled(enabled) ?? Promise.resolve(false);

export const startListening = () =>
  nativeModule?.startListening() ?? Promise.resolve([] as DayframeHealthWake[]);

export const complete = (id: string, success: boolean) =>
  nativeModule?.complete(id, success) ?? Promise.resolve(false);

export const getStatus = () => nativeModule?.getStatus() ?? Promise.resolve(null);

export const addWakeListener = (
  listener: (wake: DayframeHealthWake) => void
): EventSubscription | null => nativeModule?.addListener("onWake", listener) ?? null;
