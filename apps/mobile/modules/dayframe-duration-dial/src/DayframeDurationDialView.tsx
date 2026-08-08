import { requireNativeViewManager } from "expo-modules-core";
import { useMemo, type ComponentType } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

export type DayframeDurationDialHandle = "start" | "end" | "range";

export type DayframeDurationDialInteraction = {
  deltaMinutes: number;
  handle: DayframeDurationDialHandle;
  interactionId: string;
  phase: "began" | "changed" | "ended" | "cancelled";
  presentationId: number;
};

export type DayframeDurationDialModel = {
  endMs: number;
  mode: "running" | "stopped";
  modelVersion: 1;
  nowMs: number;
  presentationId: number;
  reduceMotion: boolean;
  revision: number;
  startMs: number;
  theme: {
    accent: string;
    accentSoft: string;
    border: string;
    onAccent: string;
    surface: string;
    surfaceMuted: string;
    textPrimary: string;
    textSecondary: string;
  };
};

export type DayframeDurationDialViewProps = ViewProps & {
  model: DayframeDurationDialModel;
  onInteraction?: (
    event: NativeSyntheticEvent<DayframeDurationDialInteraction>
  ) => void;
};

type NativeProps = Omit<DayframeDurationDialViewProps, "model"> & {
  modelJSON: string;
};

const NativeDayframeDurationDial: ComponentType<NativeProps> =
  requireNativeViewManager("DayframeDurationDial");

export function DayframeDurationDialView({
  model,
  ...props
}: DayframeDurationDialViewProps) {
  const modelJSON = useMemo(() => JSON.stringify(model), [model]);
  return <NativeDayframeDurationDial {...props} modelJSON={modelJSON} />;
}
