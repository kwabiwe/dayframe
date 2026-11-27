import { useEffect, useRef } from "react";
import { NativeEventEmitter, NativeModules, Platform } from "react-native";

type WatchTimerCommand =
  | { requestId: string; action: "start" }
  | { requestId: string; action: "stop"; entryId: string };

const watchBridge = Platform.OS === "ios" ? NativeModules.DayframeWatchBridge : undefined;

export function useWatchTimer(
  ownerKey: string | null,
  entryId: string | null,
  startedAt: string | null,
  apply: (command: WatchTimerCommand) => Promise<boolean>
) {
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    if (!watchBridge) return;
    const events = new NativeEventEmitter(watchBridge);
    const subscription = events.addListener("dayframeWatchTimerCommand", (command: WatchTimerCommand) => {
      void applyRef.current(command).then(
        (accepted) => watchBridge.completeTimerCommand(command.requestId, accepted),
        () => watchBridge.completeTimerCommand(command.requestId, false)
      );
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    watchBridge?.updateTimerSnapshot(ownerKey, entryId, startedAt);
  }, [ownerKey, entryId, startedAt]);
}
