import { useMemo, useRef, type MutableRefObject } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Gesture,
  GestureDetector,
  type GestureType
} from "react-native-gesture-handler";
import {
  DayframeDurationDialView,
  type DayframeDurationDialInteraction
} from "../../modules/dayframe-duration-dial";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import {
  adjustTimeEntryDial,
  roundTimeEntryDialDuration,
  roundTimeEntryDialStop,
  TIME_ENTRY_DIAL_MAX_DURATION_MS,
  TIME_ENTRY_DIAL_MIN_DURATION_MS,
  type TimeEntryDialInterval
} from "@/lib/timeEntryDurationDial";

type TimeEntryDurationDialProps = {
  disabled: boolean;
  endMs: number;
  lastStoppedAt: string | null;
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

export function TimeEntryDurationDial({
  disabled,
  endMs,
  lastStoppedAt,
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
  const model = useMemo(() => ({
    endMs,
    mode,
    modelVersion: 1 as const,
    nowMs,
    presentationId,
    reduceMotion,
    revision,
    startMs,
    theme: {
      accent: theme.accent,
      accentSoft: theme.accentSoft,
      border: theme.border,
      onAccent: theme.onAccent,
      surface: theme.surfaceRaised,
      surfaceMuted: theme.surfaceMuted,
      textPrimary: theme.textPrimary,
      textSecondary: theme.textSecondary
    }
  }), [
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

  const lastStopMs = lastStoppedAt ? new Date(lastStoppedAt).getTime() : Number.NaN;
  const lastStopAllowed = Number.isFinite(lastStopMs) &&
    effectiveEndMs - lastStopMs >= TIME_ENTRY_DIAL_MIN_DURATION_MS &&
    effectiveEndMs - lastStopMs <= TIME_ENTRY_DIAL_MAX_DURATION_MS;

  return (
    <View style={styles.durationDialSection} testID="time-entry-duration-dial-section">
      <GestureDetector gesture={nativeDialGesture}>
        <DayframeDurationDialView
          accessibilityLabel="Duration dial"
          model={model}
          onInteraction={(event) => handleInteraction(event.nativeEvent)}
          pointerEvents={disabled ? "none" : "auto"}
          style={styles.durationDialNativeView}
          testID="time-entry-duration-dial"
        />
      </GestureDetector>
      <View style={styles.durationDialQuickActions}>
        {lastStopAllowed ? (
          <DialAction
            disabled={disabled}
            label="Set to last stop time"
            onPress={() => {
              onInteractionStart();
              onChange({ startMs: lastStopMs, endMs: effectiveEndMs });
            }}
            styles={styles}
          />
        ) : null}
        {mode === "stopped" ? (
          <DialAction
            disabled={disabled}
            label="Round stop time"
            onPress={() => {
              onInteractionStart();
              onChange(roundTimeEntryDialStop({ startMs, endMs }));
            }}
            styles={styles}
          />
        ) : null}
        <DialAction
          disabled={disabled}
          label="Round duration"
          onPress={() => {
            onInteractionStart();
            onChange(roundTimeEntryDialDuration(
              { startMs, endMs: effectiveEndMs },
              mode,
              effectiveEndMs
            ));
          }}
          styles={styles}
        />
      </View>
    </View>
  );
}

function DialAction({
  disabled,
  label,
  onPress,
  styles
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
  styles: MobileStyles;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={pressable([
        styles.durationDialAction,
        disabled ? styles.buttonDisabled : null
      ], styles.buttonPressed)}
    >
      <Text style={styles.durationDialActionText}>{label}</Text>
    </Pressable>
  );
}
