import { useMemo, useRef, type MutableRefObject } from "react";
import { View } from "react-native";
import { useClockFormat } from "@/lib/clockFormat";
import {
  Gesture,
  GestureDetector,
  type GestureType
} from "react-native-gesture-handler";
import {
  DayframeDurationDialView,
  type DayframeDurationDialInteraction
} from "../../modules/dayframe-duration-dial";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";
import {
  adjustTimeEntryDial,
  roundTimeEntryDialDuration,
  type TimeEntryDialInterval
} from "@/lib/timeEntryDurationDial";
import type { TimeEntrySheetLayoutDensity } from "@/lib/timeEntrySheetDraft";

type TimeEntryDurationDialProps = {
  /** The chosen activity's colour for the ring and knobs (Blocks prototype), at least 3:1; coral without one. */
  activityColor?: string | null;
  disabled: boolean;
  endMs: number;
  layoutDensity: TimeEntrySheetLayoutDensity;
  mode: "running" | "stopped";
  nowMs: number;
  onChange: (interval: TimeEntryDialInterval) => void;
  onInteractionStart: () => void;
  presentationId: number;
  reduceMotion: boolean;
  revision: number;
  sheetDismissGestureRef: MutableRefObject<GestureType | undefined>;
  startMs: number;
  styles: MobileStyles;
  theme: MobileTheme;
};

/**
 * The dial's empty track: a step darker than the sheet in Dark (the prototype's --inset), and the
 * muted fill in Light, where the inset token is too close to the white sheet to see.
 */
export function dialTrackColor(theme: MobileTheme) {
  return theme.mode === "dark" ? theme.surfaceInset : theme.surfaceMuted;
}

export function TimeEntryDurationDial({
  activityColor = null,
  disabled,
  endMs,
  layoutDensity,
  mode,
  nowMs,
  onChange,
  onInteractionStart,
  presentationId,
  reduceMotion,
  revision,
  sheetDismissGestureRef,
  startMs,
  styles,
  theme
}: TimeEntryDurationDialProps) {
  const snapshotsRef = useRef(new Map<string, TimeEntryDialInterval>());
  const nativeDialGesture = useMemo(
    () => Gesture.Native()
      .disallowInterruption(true)
      .blocksExternalGesture(sheetDismissGestureRef),
    [sheetDismissGestureRef]
  );

  const effectiveEndMs = mode === "running" ? nowMs : endMs;
  const clockFormat = useClockFormat();
  const model = useMemo(() => ({
    clockFormat,
    endMs,
    mode,
    modelVersion: 1 as const,
    nowMs,
    presentationId,
    reduceMotion,
    revision,
    roundDurationEnabled: mode === "stopped" ? !disabled : undefined,
    startMs,
    theme: {
      accent: theme.accent,
      accentSoft: theme.accentSoft,
      arc: activityColor ?? theme.accent,
      track: dialTrackColor(theme),
      border: theme.border,
      onAccent: theme.onAccent,
      surface: theme.surfaceRaised,
      surfaceMuted: theme.surfaceMuted,
      textPrimary: theme.textPrimary,
      textSecondary: theme.textSecondary
    }
  }), [
    activityColor,
    clockFormat,
    disabled,
    endMs,
    mode,
    nowMs,
    presentationId,
    reduceMotion,
    revision,
    startMs,
    theme
  ]);

  function handleInteraction(interaction: DayframeDurationDialInteraction) {
    if (disabled || interaction.presentationId !== presentationId) return;
    if (interaction.phase === "began") {
      snapshotsRef.current.set(interaction.interactionId, {
        startMs,
        endMs: effectiveEndMs
      });
      onInteractionStart();
      return;
    }
    const snapshot = snapshotsRef.current.get(interaction.interactionId);
    if (!snapshot) return;
    if (interaction.phase === "cancelled") {
      onChange(snapshot);
      snapshotsRef.current.delete(interaction.interactionId);
      return;
    }
    onChange(adjustTimeEntryDial({
      handle: interaction.handle,
      interval: snapshot,
      minuteDelta: interaction.deltaMinutes,
      mode,
      nowMs: snapshot.endMs
    }));
    if (interaction.phase === "ended") {
      snapshotsRef.current.delete(interaction.interactionId);
    }
  }

  return (
    <View
      pointerEvents="box-none"
      style={styles.durationDialSection}
      testID="time-entry-duration-dial-section"
    >
      <GestureDetector gesture={nativeDialGesture}>
        <DayframeDurationDialView
          accessibilityLabel="Duration dial"
          model={model}
          onInteraction={(event) => handleInteraction(event.nativeEvent)}
          onRoundDuration={({ nativeEvent }) => {
            if (disabled || mode !== "stopped" || nativeEvent.presentationId !== presentationId || nativeEvent.revision !== revision) return;
            onInteractionStart();
            onChange(roundTimeEntryDialDuration({ startMs, endMs }, mode, endMs));
          }}
          pointerEvents={disabled ? "none" : "auto"}
          style={[
            styles.durationDialNativeView,
            layoutDensity === "compact" ? styles.durationDialNativeViewCompact : null,
            layoutDensity === "condensed" ? styles.durationDialNativeViewCondensed : null
          ]}
          testID="time-entry-duration-dial"
        />
      </GestureDetector>
    </View>
  );
}
