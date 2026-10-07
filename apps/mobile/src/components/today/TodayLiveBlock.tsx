import type { ComponentProps } from "react";
import { useCallback, useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { PrimaryTimerGlyph } from "../PrimaryTimerAction";
import { ActivityIcon, DayframeIcon } from "../icons/DayframeIcon";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "../accessibility/diagnostics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { BLOCKS_SPRING, useBlockLanding, useBreathingRing, type LandingRequest } from "../../lib/blocksMotion";
import { playHaptic } from "../../lib/haptics";
import { LIVE_FLIGHT_NODE, flightNodeRef } from "../../lib/stopFlight";
import { LIVE_SWIPE_COMMIT, liveSwipeOffset, liveSwipeRawFor } from "../../lib/todaySwitch";
import { LiveOdometer } from "./LiveOdometer";
import { TODAY_CARD, TODAY_CARD_ACTIONS_WIDTH, colorWithAlpha, spokenDuration } from "./todayBlocksLayout";

export type TodayLiveBlockPresentation = {
  /** Stored palette key or legacy colour; null when the entry has no activity. */
  categoryColor: string | null;
  categoryIcon: string | null;
  categoryLabel: string | null;
  elapsedLabel: string;
  elapsedSeconds: number;
  /**
   * When the running entry started. A switch (a new start) shows its timer at rest instead of rolling
   * to it; the queued Start's optimistic id being swapped for the server's keeps the same start.
   */
  startedAt?: string;
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
  ghostContentStyle,
  landing,
  onAddTime,
  onOpen,
  onStop,
  onSwitch,
  reduceMotion,
  theme,
}: {
  active: TodayLiveBlockPresentation;
  actionsStyle?: ComponentProps<typeof Animated.View>["style"];
  detailsStyle?: ComponentProps<typeof Animated.View>["style"];
  diagnostic?: MobileAccessibilityDiagnostic;
  /** Set only on the Stop flight's ghost: the content fades with it; the ghost is never measured or swiped. */
  ghostContentStyle?: ComponentProps<typeof Reanimated.View>["style"];
  landing: LandingRequest | null;
  onAddTime: () => void;
  onOpen: () => void;
  onStop: () => void;
  /** Opens the Switch sheet; pulling the block left past the commit point and letting go calls it. */
  onSwitch: () => void;
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
  const ghost = ghostContentStyle !== undefined;
  const swipe = useLiveSwipe({ enabled: active.hasLiveActiveTimer && !ghost, onSwitch, reduceMotion });
  const registerLiveNode = useMemo(() => flightNodeRef(ghost ? undefined : LIVE_FLIGHT_NODE), [ghost]);

  return (
    <View style={styles.wrap}>
      <Reanimated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.switchReveal, { backgroundColor: theme.surfaceMuted }, swipe.revealStyle]}
        testID="today-live-switch-reveal"
      >
        <DayframeIcon color={theme.textPrimary} glyph={DAYFRAME_APP_ICONS.startAgain} size={20} />
        <Text {...mobileTextProps("control")} style={[styles.switchText, { color: theme.textPrimary }]}>Switch</Text>
      </Reanimated.View>
    <GestureDetector gesture={swipe.gesture}>
    <Reanimated.View
      collapsable={false}
      onLayout={swipe.onCardLayout}
      ref={registerLiveNode}
      style={[styles.card, { backgroundColor: colors.fill }, swipe.cardStyle]}
      testID={ghost ? "today-live-ghost" : "today-live-block"}
    >
      <Reanimated.View
        pointerEvents="none"
        style={[styles.ring, { borderColor: colors.text }, ringStyle]}
        testID="today-live-ring"
      />
      <Pressable
        accessibilityActions={active.hasLiveActiveTimer ? [{ name: "switch", label: "Switch" }] : undefined}
        accessibilityLabel="Edit running timer"
        accessibilityRole="button"
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "switch" && active.hasLiveActiveTimer) onSwitch();
        }}
        accessibilityValue={{ text: `${activityName}. ${active.title}. ${spokenDuration(active.elapsedSeconds)} so far.` }}
        disabled={!active.hasLiveActiveTimer}
        onPress={onOpen}
        style={({ pressed }) => [styles.main, pressed && active.hasLiveActiveTimer ? styles.pressed : null]}
      >
        <Reanimated.View style={[styles.content, landingStyle, ghostContentStyle]} testID="today-live-content">
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
            <LiveOdometer color={colors.text} key={active.startedAt ?? "live"} label={active.elapsedLabel} reduceMotion={reduceMotion} />
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
      <Reanimated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, ghostContentStyle]}>
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
      </Reanimated.View>
    </Reanimated.View>
    </GestureDetector>
    </View>
  );
}

/**
 * Pull the live block left to switch (Blocks prototype): one Pan owns the card's offset on the UI
 * thread. It activates after 8 points sideways and fails after 10 points vertically, so Today keeps
 * scrolling. Past 90 points the card rubber-bands, tilts a little and arms with one tick; letting go
 * springs it home with `land` and, when armed, opens the Switch sheet. Reduce Motion keeps the
 * finger tracking without the tilt and returns in 120 ms.
 */
function useLiveSwipe({ enabled, onSwitch, reduceMotion }: { enabled: boolean; onSwitch: () => void; reduceMotion: boolean }) {
  // A card grabbed while it springs home continues from where it is: the raw pull is recovered from
  // the shown offset with liveSwipeRawFor, so the band applies once.
  const offset = useSharedValue(0);
  const base = useSharedValue(0);
  const armed = useSharedValue(0);
  const cardWidth = useSharedValue(0);
  const cardHeight = useSharedValue(0);
  const commit = useCallback(() => onSwitch(), [onSwitch]);
  const tick = useCallback(() => playHaptic("tick"), []);

  const gesture = useMemo(() => Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-8, 8])
    .failOffsetY([-10, 10])
    .onTouchesDown((event, manager) => {
      "worklet";
      // As in the prototype, a touch that starts on Add past time or Stop never becomes a swipe.
      const touch = event.allTouches[0];
      if (touch && liveActionsContain(touch.x, touch.y, cardWidth.value, cardHeight.value)) manager.fail();
    })
    .onStart(() => {
      "worklet";
      // Continue from the raw pull that produced what is shown now.
      base.value = liveSwipeRawFor(offset.value);
    })
    .onUpdate((event) => {
      "worklet";
      const raw = Math.min(0, base.value + event.translationX);
      offset.value = liveSwipeOffset(raw);
      // Arming needs this gesture's own travel past the commit point, as Today's rows do.
      const next = event.translationX < -LIVE_SWIPE_COMMIT && raw < -LIVE_SWIPE_COMMIT ? 1 : 0;
      if (next !== armed.value) {
        armed.value = next;
        if (next) runOnJS(tick)();
      }
    })
    .onEnd((_event, success) => {
      "worklet";
      // A gesture the system cancels ends unsuccessful: the card goes home and nothing opens.
      const open = success && armed.value === 1;
      armed.value = 0;
      offset.value = reduceMotion
        ? withTiming(0, { duration: 120, reduceMotion: ReduceMotion.Never })
        : withSpring(0, { ...BLOCKS_SPRING.land, reduceMotion: ReduceMotion.Never });
      if (open) runOnJS(commit)();
    })
    .onFinalize(() => {
      "worklet";
      armed.value = 0;
    }), [armed, base, cardHeight, cardWidth, commit, enabled, offset, reduceMotion, tick]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offset.value },
      { rotate: reduceMotion ? "0deg" : `${offset.value / 60}deg` },
    ],
  }));
  const revealStyle = useAnimatedStyle(() => ({ opacity: offset.value < 0 ? 1 : 0 }));
  const onCardLayout = useCallback((event: LayoutChangeEvent) => {
    cardWidth.value = event.nativeEvent.layout.width;
    cardHeight.value = event.nativeEvent.layout.height;
  }, [cardHeight, cardWidth]);
  return { cardStyle, gesture, onCardLayout, revealStyle };
}

/** Whether a point on the card (from its top-left) falls on Add past time or Stop. */
export function liveActionsContain(x: number, y: number, width: number, height: number) {
  "worklet";
  if (width <= 0 || height <= 0) return false;
  const right = width - TODAY_CARD.padding;
  const bottom = height - TODAY_CARD.liveBottomPadding;
  return x >= right - TODAY_CARD_ACTIONS_WIDTH && x <= right && y >= bottom - TODAY_CARD.primaryActionSize && y <= bottom;
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  switchReveal: {
    alignItems: "center",
    borderRadius: TODAY_CARD.radius,
    bottom: 0,
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    left: 0,
    paddingRight: 22,
    position: "absolute",
    right: 0,
    top: 0,
  },
  switchText: { fontSize: 15, fontWeight: "700" },
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
