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
  /** Always 1: every minute (owner, 16 Oct 2026). The native view still reads the field. */
  minuteInterval: 1;
  modelVersion: 1;
  presentationId: number;
  /** Bumped by an outside change (the dial) so the wheel re-aims even to the same value. */
  revision: number;
  /** The card's instant: the wheel keeps its day and changes only the time. */
  valueMs: number;
};

export type DayframeTimeWheelChange = {
  presentationId: number;
  /**
   * "user": a spin. "normalized": the wheel clamped the value React sent to its bounds (or minute
   * step) — UIKit does that silently, so the wheel reports what it now shows.
   */
  reason: "user" | "normalized";
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
