import {
  NativeModule,
  requireOptionalNativeModule,
  type EventSubscription
} from "expo-modules-core";

export type DayframeBackgroundExecutionExpiration = {
  generation: number;
  leaseTokens: string[];
  reason: "expired";
};

type DayframeBackgroundExecutionEvents = {
  onExpired(event: DayframeBackgroundExecutionExpiration): void;
};

declare class DayframeBackgroundExecutionNativeModule extends NativeModule<
  DayframeBackgroundExecutionEvents
> {
  begin(name: string): Promise<string | null>;
  end(leaseToken: string, reason: string): Promise<boolean>;
  endAll(reason: string): Promise<number>;
}

const nativeModule = requireOptionalNativeModule<DayframeBackgroundExecutionNativeModule>(
  "DayframeBackgroundExecution"
);

export const isAvailable = () => nativeModule !== null;

export const begin = (name: string) => nativeModule?.begin(name) ?? Promise.resolve(null);

export const end = (leaseToken: string, reason: string) =>
  nativeModule?.end(leaseToken, reason) ?? Promise.resolve(false);

export const endAll = (reason: string) =>
  nativeModule?.endAll(reason) ?? Promise.resolve(0);

export const addExpirationListener = (
  listener: (event: DayframeBackgroundExecutionExpiration) => void
): EventSubscription | null => nativeModule?.addListener("onExpired", listener) ?? null;

