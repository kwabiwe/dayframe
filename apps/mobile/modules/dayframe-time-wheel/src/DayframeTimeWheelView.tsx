import { requireNativeViewManager } from "expo-modules-core";
import { useMemo, type ComponentType } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

/** What React shows in the wheel. React owns the draft; the wheel reports the user's spins. */
export type DayframeTimeWheelModel = {
  colorScheme: "light" | "dark";
  /** Latest choosable instant, inclusive (a running start can't pass now). */
  maximumMs?: number | null;
  /** Earliest choosable instant, inclusive. */
  minimumMs?: number | null;
  /** 5 by default; 1 for "Every minute", or a time that isn't on a 5-minute step. */
  minuteInterval: 1 | 5;
  modelVersion: 1;
  presentationId: number;
  /** Bumped by an outside change (the dial) so the wheel re-aims even to the same value. */
  revision: number;
  /** The card's instant: the wheel keeps its day and changes only the time. */
  valueMs: number;
};

export type DayframeTimeWheelChange = {
  presentationId: number;
  revision: number;
  valueMs: number;
};

export type DayframeTimeWheelViewProps = ViewProps & {
  model: DayframeTimeWheelModel;
  onTimeChange?: (event: NativeSyntheticEvent<DayframeTimeWheelChange>) => void;
};

type NativeProps = Omit<DayframeTimeWheelViewProps, "model"> & { modelJSON: string };

const NativeDayframeTimeWheel: ComponentType<NativeProps> = requireNativeViewManager("DayframeTimeWheel");

export function DayframeTimeWheelView({ model, ...props }: DayframeTimeWheelViewProps) {
  const modelJSON = useMemo(() => JSON.stringify(model), [model]);
  return <NativeDayframeTimeWheel {...props} modelJSON={modelJSON} />;
}
