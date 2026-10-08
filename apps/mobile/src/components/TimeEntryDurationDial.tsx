import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
import {
  Gesture,
  GestureDetector,
  type GestureType
} from "react-native-gesture-handler";
import {
  DayframeDurationDialView,
  type DayframeDurationDialInteraction
} from "../../modules/dayframe-duration-dial";
import { DayframeIcon } from "./icons/DayframeIcon";
import { localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import { pressable, type MobileStyles, type MobileTheme } from "@/lib/mobileTheme";
import { mobileTextProps } from "@/lib/mobileTypography";
import {
  adjustTimeEntryDial,
  roundTimeEntryDialDuration,
  roundTimeEntryDialStop,
  TIME_ENTRY_DIAL_MAX_DURATION_MS,
  TIME_ENTRY_DIAL_MIN_DURATION_MS,
  type TimeEntryDialInterval
} from "@/lib/timeEntryDurationDial";
import type { TimeEntrySheetLayoutDensity } from "@/lib/timeEntrySheetDraft";

type TimeEntryDurationDialProps = {
  /** The chosen activity's colour for the ring and knobs (Blocks prototype), at least 3:1; coral without one. */
  activityColor?: string | null;
  disabled: boolean;
  endMs: number;
  lastStoppedAt: string | null;
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
  lastStoppedAt,
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
  // The rounding shortcuts live behind "…" on the hint row (Blocks parity step 4e); a new
  // presentation, a turn of the dial or a shortcut closes them again.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  useEffect(() => {
    setShortcutsOpen(false);
  }, [presentationId]);
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
      setShortcutsOpen(false);
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
  // Offered only when it would move the start, and keeps the block within the dial's limits.
  const lastStopAllowed = Number.isFinite(lastStopMs) &&
    Math.abs(lastStopMs - startMs) >= 60_000 &&
    effectiveEndMs - lastStopMs >= TIME_ENTRY_DIAL_MIN_DURATION_MS &&
    effectiveEndMs - lastStopMs <= TIME_ENTRY_DIAL_MAX_DURATION_MS;

  const shortcuts: { accessibilityLabel: string; apply: () => TimeEntryDialInterval; label: string; testID: string }[] = [];
  if (lastStopAllowed) {
    shortcuts.push({
      accessibilityLabel: `Set start to the last stop time, ${clockText(lastStopMs)}`,
      apply: () => ({ startMs: lastStopMs, endMs: effectiveEndMs }),
      label: `Last stop ${clockText(lastStopMs)}`,
      testID: "time-entry-set-last-stop-time"
    });
  }
  if (mode === "stopped") {
    shortcuts.push({
      accessibilityLabel: "Round stop time",
      apply: () => roundTimeEntryDialStop({ startMs, endMs }),
      label: "Round end",
      testID: "time-entry-round-stop-time"
    });
    shortcuts.push({
      accessibilityLabel: "Round duration",
      apply: () => roundTimeEntryDialDuration({ startMs, endMs: effectiveEndMs }, mode, effectiveEndMs),
      label: "Round length",
      testID: "time-entry-round-duration"
    });
  }
  const showShortcuts = shortcutsOpen && shortcuts.length > 0;

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
          pointerEvents={disabled ? "none" : "auto"}
          style={[
            styles.durationDialNativeView,
            layoutDensity === "compact" ? styles.durationDialNativeViewCompact : null,
            layoutDensity === "condensed" ? styles.durationDialNativeViewCondensed : null,
            mode === "stopped" && layoutDensity === "regular" ? styles.durationDialNativeViewStopped : null,
            mode === "stopped" && layoutDensity === "compact" ? styles.durationDialNativeViewStoppedCompact : null
          ]}
          testID="time-entry-duration-dial"
        />
      </GestureDetector>
      {/* Blocks prototype hint under the dial; the row is tucked into the dial's empty bottom band. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.durationDialHintRow,
          layoutDensity === "compact" ? styles.durationDialHintRowCompact : null,
          layoutDensity === "condensed" ? styles.durationDialHintRowCondensed : null,
          // A stopped block's range handle orbits outside the ring, through that empty band.
          mode === "stopped" ? styles.durationDialHintRowStopped : null
        ]}
        testID="time-entry-dial-hint-row"
      >
        {showShortcuts ? (
          <Reanimated.View
            entering={localPresenceEntering(reduceMotion, "fade")}
            exiting={localPresenceExiting(reduceMotion)}
            key="shortcuts"
            style={styles.durationDialShortcuts}
          >
            <ScrollView
              contentContainerStyle={styles.durationDialShortcutsContent}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
            >
              {shortcuts.map((shortcut) => (
                <DialShortcut
                  accessibilityLabel={shortcut.accessibilityLabel}
                  disabled={disabled}
                  key={shortcut.testID}
                  label={shortcut.label}
                  onPress={() => {
                    onInteractionStart();
                    onChange(shortcut.apply());
                    setShortcutsOpen(false);
                  }}
                  styles={styles}
                  testID={shortcut.testID}
                />
              ))}
            </ScrollView>
          </Reanimated.View>
        ) : (
          <Reanimated.View
            entering={localPresenceEntering(reduceMotion, "fade")}
            exiting={localPresenceExiting(reduceMotion)}
            key="hint"
            pointerEvents="none"
            style={[styles.durationDialHint, shortcuts.length ? styles.durationDialHintBalanced : null]}
          >
            <Text {...mobileTextProps("metadata")} numberOfLines={2} style={styles.durationDialHintText}>
              {`Spin the ring to move the ${mode === "running" ? "start" : "end"}.\nOne turn is an hour.`}
            </Text>
          </Reanimated.View>
        )}
        {shortcuts.length ? (
          <Pressable
            accessibilityLabel={showShortcuts ? "Hide time shortcuts" : "Time shortcuts"}
            accessibilityRole="button"
            accessibilityState={{ disabled, expanded: showShortcuts }}
            disabled={disabled}
            onPress={() => {
              onInteractionStart();
              setShortcutsOpen((open) => !open);
            }}
            onTouchStart={(event) => event.stopPropagation()}
            style={pressable([styles.durationDialShortcutToggle, disabled ? styles.buttonDisabled : null], styles.buttonPressed)}
            testID="time-entry-dial-shortcuts"
          >
            <DayframeIcon
              color={theme.textSecondary}
              glyph={showShortcuts ? DAYFRAME_APP_ICONS.close : DAYFRAME_APP_ICONS.more}
              size={18}
            />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function clockText(ms: number) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function DialShortcut({
  accessibilityLabel,
  disabled,
  label,
  onPress,
  styles,
  testID
}: {
  accessibilityLabel: string;
  disabled: boolean;
  label: string;
  onPress: () => void;
  styles: MobileStyles;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      onTouchStart={(event) => event.stopPropagation()}
      style={pressable([styles.durationDialShortcut, disabled ? styles.buttonDisabled : null], styles.buttonPressed)}
      testID={testID}
    >
      <Text {...mobileTextProps("control")} numberOfLines={1} style={styles.durationDialShortcutText}>
        {label}
      </Text>
    </Pressable>
  );
}
