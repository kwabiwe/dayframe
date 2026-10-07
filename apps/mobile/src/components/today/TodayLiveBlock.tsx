import type { ComponentProps } from "react";
import { useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { PrimaryTimerGlyph } from "../PrimaryTimerAction";
import { ActivityIcon, DayframeIcon } from "../icons/DayframeIcon";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "../accessibility/diagnostics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { useBlockLanding, useBreathingRing, type LandingRequest } from "../../lib/blocksMotion";
import { LiveOdometer } from "./LiveOdometer";
import { TODAY_CARD, TODAY_CARD_ACTIONS_WIDTH, colorWithAlpha, spokenDuration } from "./todayBlocksLayout";

export type TodayLiveBlockPresentation = {
  /** Stored palette key or legacy colour; null when the entry has no activity. */
  categoryColor: string | null;
  categoryIcon: string | null;
  categoryLabel: string | null;
  elapsedLabel: string;
  elapsedSeconds: number;
  /** The running entry; a different entry (a switch) shows its timer at rest instead of rolling to it. */
  entryId?: string;
  hasLiveActiveTimer: boolean;
  startedLabel: string | null;
  title: string;
  titleIsPlaceholder: boolean;
};

const LIVE_LANDING_DISTANCE = 14;

/**
 * The running entry as one solid activity block, laid out as the prototype's live card: activity
 * chip and Recording, the description, the rolling timer, then the start time beside Stop. Tap
 * edits it. Add past time stays beside Stop until the Play orb and entry sheet take it over. Only
 * this block carries the breathing ring. The landing moves the block's content only: the card,
 * its ring and the actions stay where they are.
 */
export function TodayLiveBlock({
  active,
  actionsStyle,
  detailsStyle,
  diagnostic,
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
  diagnostic?: MobileAccessibilityDiagnostic;
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
  const titleStyle = [styles.title, { color: colors.text }, active.titleIsPlaceholder ? styles.placeholder : null];

  return (
    <View style={[styles.card, { backgroundColor: colors.fill }]} testID="today-live-block">
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
        <Reanimated.View style={[styles.content, landingStyle]} testID="today-live-content">
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
            onLayout={(event) => recordMobileLayout(diagnostic, "today.timer.title.frame", event)}
            onTextLayout={(event) => recordMobileTextLayout(diagnostic, "today.timer.title", event, "itemTitle", titleStyle)}
            style={titleStyle}
          >
            {active.title}
          </Text>
          <Animated.View
            onLayout={(event) => recordMobileLayout(diagnostic, "today.timer.elapsed.frame", event)}
            style={[styles.time, detailsStyle]}
          >
            <LiveOdometer color={colors.text} key={active.entryId ?? "live"} label={active.elapsedLabel} reduceMotion={reduceMotion} />
          </Animated.View>
          {/* The start time wraps instead of clipping: when it is too wide to sit beside the
              actions, the reserved action space moves to its own line and the card grows. */}
          <View style={styles.footer}>
            <Animated.View style={[styles.details, detailsStyle]}>
              {active.startedLabel ? (
                <Text {...mobileTextProps("metadata")} numberOfLines={2} style={[styles.meta, { color: colors.text }]}>
                  {active.startedLabel}
                </Text>
              ) : null}
            </Animated.View>
            <View pointerEvents="none" style={styles.actionsReserve} testID="today-live-actions-reserve" />
          </View>
        </Reanimated.View>
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
          style={({ pressed }) => [
            styles.primaryAction,
            { backgroundColor: colors.text },
            pressed ? styles.stopPressed : null,
          ]}
          testID="today-live-stop"
        >
          <PrimaryTimerGlyph color={colors.fill} mode="stop" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: TODAY_CARD.radius,
    overflow: "hidden",
  },
  ring: {
    borderRadius: TODAY_CARD.radius,
    borderWidth: 2,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  main: {
    paddingBottom: TODAY_CARD.liveBottomPadding,
    paddingHorizontal: TODAY_CARD.padding,
    paddingTop: TODAY_CARD.padding,
  },
  content: { gap: 6 },
  pressed: { opacity: 0.82 },
  stopPressed: { transform: [{ scale: 0.92 }] },
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
  chipText: { flexShrink: 1, fontSize: 12.5, fontWeight: "700" },
  recording: { alignItems: "center", flexDirection: "row", gap: 7 },
  recordingDot: { borderRadius: 4, height: 8, width: 8 },
  recordingText: { fontSize: 12, fontWeight: "700" },
  title: { fontSize: 19, fontWeight: "700", letterSpacing: -0.2, lineHeight: 24, marginTop: 6 },
  placeholder: { fontStyle: "italic", fontWeight: "400" },
  time: { alignSelf: "stretch" },
  footer: {
    alignItems: "center",
    columnGap: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
    minHeight: TODAY_CARD.primaryActionSize,
  },
  details: { flexShrink: 1, maxWidth: "100%" },
  actionsReserve: {
    height: TODAY_CARD.primaryActionSize,
    marginLeft: "auto",
    width: TODAY_CARD_ACTIONS_WIDTH,
  },
  meta: { fontSize: 13, fontWeight: "600" },
  actions: {
    alignItems: "center",
    bottom: TODAY_CARD.liveBottomPadding,
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
    shadowColor: "#000000",
    shadowOffset: { height: 8, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 9,
    width: TODAY_CARD.primaryActionSize,
  },
});
