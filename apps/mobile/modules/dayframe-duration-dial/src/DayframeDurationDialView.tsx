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
  /** "12h" or "24h" (PRD D18) for the "since 09:30" / "09:30–10:35" detail. */
  clockFormat: "12h" | "24h";
  endMs: number;
  mode: "running" | "stopped";
  modelVersion: 1;
  nowMs: number;
  presentationId: number;
  reduceMotion: boolean;
  revision: number;
  /** Omitted in running mode and by older bundles. */
  roundDurationEnabled?: boolean;
  startMs: number;
  theme: {
    accent: string;
    accentSoft: string;
    /** The ring's colour: the chosen activity's display colour, or the accent. */
    arc?: string;
    /** The ring's empty track. */
    track?: string;
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
  onRoundDuration?: (event: NativeSyntheticEvent<{ presentationId: number; revision: number }>) => void;
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
