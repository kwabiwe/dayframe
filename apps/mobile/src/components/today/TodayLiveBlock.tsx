import type { ComponentProps } from "react";
import { useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { PrimaryTimerGlyph } from "../PrimaryTimerAction";
import { ActivityIcon, DayframeIcon } from "../icons/DayframeIcon";
import type { MobileTheme } from "../../lib/mobileTheme";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "../../lib/mobileTypography";
import { useBlockLanding, useBreathingRing, type LandingRequest } from "../../lib/blocksMotion";
import { TODAY_CARD, TODAY_CARD_ACTIONS_WIDTH, colorWithAlpha, spokenDuration } from "./todayBlocksLayout";

export type TodayLiveBlockPresentation = {
  /** Stored palette key or legacy colour; null when the entry has no activity. */
  categoryColor: string | null;
  categoryIcon: string | null;
  categoryLabel: string | null;
  elapsedLabel: string;
  elapsedSeconds: number;
  hasLiveActiveTimer: boolean;
  startedLabel: string | null;
  title: string;
  titleIsPlaceholder: boolean;
};

const LIVE_LANDING_DISTANCE = 14;

/**
 * The running entry as one solid activity block. Tap edits it; Stop and Add past time sit on the
 * shared action track. Only this block carries the breathing ring.
 */
export function TodayLiveBlock({
  active,
  actionsStyle,
  detailsStyle,
  landing,
  onAddTime,
  onOpen,
  onStop,
  reduceMotion,
  theme,
}: {
  active: TodayLiveBlockPresentation;
  actionsStyle?: ComponentProps<typeof Animated.View>["style"];
  detailsStyle?: ComponentProps<typeof Animated.View>["style"];
  landing: LandingRequest | null;
  onAddTime: () => void;
  onOpen: () => void;
  onStop: () => void;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  const colors = useMemo(() => {
    if (!active.categoryColor) return { fill: theme.surfaceRaised, text: theme.textPrimary };
    return blockColorsFor(active.categoryColor, theme.mode, active.categoryLabel ?? "");
  }, [active.categoryColor, active.categoryLabel, theme.mode, theme.surfaceRaised, theme.textPrimary]);
  const landingStyle = useBlockLanding({ distance: LIVE_LANDING_DISTANCE, reduceMotion, request: landing });
  const ringStyle = useBreathingRing({ live: active.hasLiveActiveTimer, reduceMotion });
  const activityName = active.categoryLabel ?? "No activity";

  return (
    <Reanimated.View
      style={[styles.card, { backgroundColor: colors.fill }, landingStyle]}
      testID="today-live-block"
    >
      <Reanimated.View
        pointerEvents="none"
        style={[styles.ring, { borderColor: colors.text }, ringStyle]}
        testID="today-live-ring"
      />
      <Pressable
        accessibilityLabel="Edit running timer"
        accessibilityRole="button"
        accessibilityValue={{ text: `${activityName}. ${active.title}. ${spokenDuration(active.elapsedSeconds)} so far.` }}
        disabled={!active.hasLiveActiveTimer}
        onPress={onOpen}
        style={({ pressed }) => [styles.main, pressed && active.hasLiveActiveTimer ? styles.pressed : null]}
      >
        <View style={styles.topRow}>
          <View style={[styles.chip, { backgroundColor: colorWithAlpha(colors.text, 0.14) }]}>
            {active.categoryColor ? (
              <ActivityIcon color={colors.text} icon={active.categoryIcon} name={active.categoryLabel} size={15} />
            ) : null}
            <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.chipText, { color: colors.text }]}>
              {activityName}
            </Text>
          </View>
          <View style={styles.recording}>
            <View style={[styles.recordingDot, { backgroundColor: colors.text }]} />
            <Text {...mobileTextProps("counter")} style={[styles.recordingText, { color: colors.text }]}>
              Recording
            </Text>
          </View>
        </View>
        <Text
          {...mobileTextProps("itemTitle")}
          numberOfLines={2}
          style={[styles.title, { color: colors.text }, active.titleIsPlaceholder ? styles.placeholder : null]}
        >
          {active.title}
        </Text>
        <Animated.View style={[styles.details, detailsStyle]}>
          <Text {...mobileTextProps("numeric")} numberOfLines={1} style={[styles.elapsed, { color: colors.text }]}>
            {active.elapsedLabel}
          </Text>
          {active.startedLabel ? (
            <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.meta, { color: colors.text }]}>
              {active.startedLabel}
            </Text>
          ) : null}
        </Animated.View>
      </Pressable>
      <Animated.View
        pointerEvents={active.hasLiveActiveTimer ? "box-none" : "none"}
        style={[styles.actions, actionsStyle]}
      >
        <Pressable
          accessibilityLabel="Add past time"
          accessibilityRole="button"
          onPress={(event: GestureResponderEvent) => {
            event.stopPropagation();
            onAddTime();
          }}
          style={({ pressed }) => [
            styles.secondaryAction,
            { backgroundColor: colorWithAlpha(colors.text, 0.16) },
            pressed ? styles.pressed : null,
          ]}
          testID="active-timer-add-past-time"
        >
          <DayframeIcon color={colors.text} glyph={DAYFRAME_APP_ICONS.add} size={20} />
        </Pressable>
        <Pressable
          accessibilityLabel="Stop current timer"
          accessibilityRole="button"
          onPress={(event: GestureResponderEvent) => {
            event.stopPropagation();
            onStop();
          }}
          style={({ pressed }) => [styles.primaryAction, { backgroundColor: colors.text }, pressed ? styles.pressed : null]}
          testID="today-live-stop"
        >
          <PrimaryTimerGlyph color={colors.fill} mode="stop" />
        </Pressable>
      </Animated.View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: TODAY_CARD.radius,
    minHeight: TODAY_CARD.minHeight,
    overflow: "hidden",
  },
  ring: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    borderRadius: TODAY_CARD.radius,
    borderWidth: 2,
  },
  main: {
    flexGrow: 1,
    minHeight: TODAY_CARD.minHeight,
    padding: TODAY_CARD.padding,
  },
  pressed: { opacity: 0.82 },
  topRow: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "space-between" },
  chip: {
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    flexShrink: 1,
    gap: 6,
    minHeight: 28,
    paddingLeft: 8,
    paddingRight: 10,
  },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: "700" },
  recording: { alignItems: "center", flexDirection: "row", gap: 6 },
  recordingDot: { borderRadius: 4, height: 8, width: 8 },
  recordingText: { fontSize: 12, fontWeight: "700" },
  title: { fontSize: 19, fontWeight: "600", letterSpacing: -0.2, lineHeight: 24, marginTop: 12 },
  placeholder: { fontStyle: "italic", fontWeight: "400" },
  details: { marginTop: "auto", paddingRight: TODAY_CARD_ACTIONS_WIDTH + 12, paddingTop: 8 },
  elapsed: {
    fontFamily: MOBILE_DISPLAY_FONT.extraBold,
    fontSize: 36,
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.7,
    lineHeight: 40,
  },
  meta: { fontSize: 13, fontWeight: "500", marginTop: 2 },
  actions: {
    alignItems: "center",
    bottom: TODAY_CARD.padding,
    flexDirection: "row",
    gap: TODAY_CARD.actionGap,
    position: "absolute",
    right: TODAY_CARD.padding,
  },
  secondaryAction: {
    alignItems: "center",
    borderRadius: TODAY_CARD.secondaryActionSize / 2,
    height: TODAY_CARD.secondaryActionSize,
    justifyContent: "center",
    width: TODAY_CARD.secondaryActionSize,
  },
  primaryAction: {
    alignItems: "center",
    borderRadius: TODAY_CARD.primaryActionSize / 2,
    height: TODAY_CARD.primaryActionSize,
    justifyContent: "center",
    width: TODAY_CARD.primaryActionSize,
  },
});
