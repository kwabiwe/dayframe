import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { DAYFRAME_BLOCKS } from "@dayframe/shared";
import { BLOCKS_SPRING } from "@/lib/blocksMotion";
import type { MobileTheme } from "@/lib/mobileTheme";
import { localPresenceEntering, localPresenceExiting } from "@/lib/motion";
import { MOBILE_DISPLAY_FONT, mobileTextProps } from "@/lib/mobileTypography";
import {
  REVIEW_DECK_SEGMENTS,
  formatReviewDeckSegmentCount,
  reviewDeckSegmentAccessibilityLabel,
  reviewDeckSegmentDimmed,
  reviewDeckSegmentName,
  type ReviewDeckSegment,
  type ReviewDeckSegmentCount
} from "@/lib/reviewDeckSegments";

/** Track padding around the thumb; the segments are 38 points tall, so the track is 44. */
const TRACK_PADDING = 3;
const thumbSpring = { ...BLOCKS_SPRING.sheet, reduceMotion: ReduceMotion.Never };

/** Neutral segment colours (UIA-081, one segmented style across the app): no coral. */
export function reviewDeckSegmentColors(theme: MobileTheme) {
  return theme.mode === "dark"
    ? { track: theme.surfaceInset, thumb: theme.surfaceMuted }
    : { track: theme.surfaceMuted, thumb: theme.surface };
}

/**
 * The Review deck's Today · Earlier control (owner decision 14 Oct 2026, option C). It owns its
 * thumb: a tap slides it with the Blocks `sheet` spring (a rapid second tap retargets the same
 * spring from where it is); with Reduce Motion, and whenever the selection changes for any other
 * reason (a focused card, hydration), the thumb is placed at once. VoiceOver reads it as a tab bar:
 * "Earlier, 9 moments, selected".
 */
export function ReviewDeckSegmentControl({
  counts,
  onSelect,
  reduceMotion,
  selected,
  theme
}: {
  counts: Record<ReviewDeckSegment, ReviewDeckSegmentCount>;
  onSelect: (segment: ReviewDeckSegment) => void;
  reduceMotion: boolean;
  selected: ReviewDeckSegment;
  theme: MobileTheme;
}) {
  const colors = reviewDeckSegmentColors(theme);
  const [trackWidth, setTrackWidth] = useState(0);
  const segmentWidth = trackWidth ? (trackWidth - TRACK_PADDING * 2) / REVIEW_DECK_SEGMENTS.length : 0;
  const index = REVIEW_DECK_SEGMENTS.indexOf(selected);
  const thumbX = useSharedValue(0);
  // Only a tap on the control animates the thumb.
  const pressed = useRef(false);
  const placed = useRef(false);
  useEffect(() => {
    if (!segmentWidth) return;
    const target = index * segmentWidth;
    const animate = pressed.current && placed.current && !reduceMotion;
    pressed.current = false;
    placed.current = true;
    thumbX.value = animate ? withSpring(target, thumbSpring) : target;
  }, [index, reduceMotion, segmentWidth, thumbX]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: thumbX.value }] }));

  return (
    <View
      accessibilityLabel="Review moments"
      accessibilityRole="tablist"
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: colors.track }]}
      testID="review-deck-segments"
    >
      {segmentWidth ? (
        <Reanimated.View
          pointerEvents="none"
          style={[styles.thumb, { backgroundColor: colors.thumb, width: segmentWidth }, thumbStyle]}
          testID="review-deck-segment-thumb"
        />
      ) : null}
      {REVIEW_DECK_SEGMENTS.map((segment) => {
        const isSelected = segment === selected;
        const count = counts[segment];
        const dimmed = reviewDeckSegmentDimmed(count);
        const countText = formatReviewDeckSegmentCount(count);
        return (
          <Pressable
            accessibilityLabel={reviewDeckSegmentAccessibilityLabel(segment, count)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            key={segment}
            onPress={() => {
              // Tapping the selected segment does nothing.
              if (isSelected) return;
              pressed.current = true;
              onSelect(segment);
            }}
            style={styles.segment}
            testID={`review-deck-segment-${segment}`}
          >
            <View style={[styles.label, dimmed ? styles.dimmed : null]}>
              <Text
                {...mobileTextProps("control")}
                numberOfLines={1}
                style={[styles.name, { color: isSelected ? theme.textPrimary : theme.textSecondary }]}
              >
                {reviewDeckSegmentName(segment)}
              </Text>
              {countText ? (
                <Text
                  {...mobileTextProps("numeric")}
                  numberOfLines={1}
                  style={[styles.count, { color: isSelected ? theme.textSecondary : theme.textMuted }]}
                >
                  {countText}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The slim "Older than 7 days" divider over the Earlier stack: shown while the top card began more
 * than 7 days ago (the bulk skip's line, and how long Location keeps its map evidence). Its row is
 * always reserved, so it appearing or going never moves the deck.
 */
export function ReviewDeckOlderDivider({
  reduceMotion,
  theme,
  visible
}: {
  reduceMotion: boolean;
  theme: MobileTheme;
  visible: boolean;
}) {
  return (
    <View style={styles.dividerSlot} testID="review-deck-divider-slot">
      {visible ? (
        <Reanimated.View
          entering={localPresenceEntering(reduceMotion)}
          exiting={localPresenceExiting(reduceMotion)}
          style={styles.divider}
          testID="review-deck-older-divider"
        >
          <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
          <Text {...mobileTextProps("metadata")} style={[styles.dividerText, { color: theme.textMuted }]}>
            Older than 7 days
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
        </Reanimated.View>
      ) : null}
    </View>
  );
}

/**
 * "Today is framed · 9 earlier": the selected segment is empty while the other still has moments.
 * One pill switches segment. It fades in and out with the deck's presence fade; the Undo toast for
 * the card thrown last hangs from `footer`, out of flow.
 */
export function ReviewDeckSegmentFramed({
  action,
  actionAccessibilityLabel,
  detail,
  focusToken,
  footer,
  onAction,
  onFocused,
  reduceMotion,
  theme,
  title
}: {
  action: string;
  actionAccessibilityLabel: string;
  detail: string;
  /** A segment switch landed here: VoiceOver focus moves to the heading. */
  focusToken: number;
  footer?: ReactNode;
  onAction: () => void;
  /** The focus token has been spent (moved VoiceOver once). */
  onFocused?: (token: number) => void;
  reduceMotion: boolean;
  theme: MobileTheme;
  title: string;
}) {
  const headingRef = useRef<Text>(null);
  useEffect(() => {
    if (!focusToken || !headingRef.current) return;
    AccessibilityInfo.sendAccessibilityEvent(headingRef.current, "focus");
    onFocused?.(focusToken);
    // Once per token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);
  return (
    <Reanimated.View
      entering={localPresenceEntering(reduceMotion)}
      exiting={localPresenceExiting(reduceMotion)}
      style={styles.framed}
      testID="review-deck-segment-framed"
    >
      <Text
        {...mobileTextProps("screenHeading")}
        accessibilityRole="header"
        ref={headingRef}
        style={[styles.framedTitle, { color: theme.textPrimary }]}
      >
        {title}
      </Text>
      <Text {...mobileTextProps("body")} style={[styles.framedCopy, { color: theme.textSecondary }]}>
        {detail}
      </Text>
      <View style={styles.framedActions}>
        <Pressable
          accessibilityLabel={actionAccessibilityLabel}
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.framedButton, { backgroundColor: theme.accent }, pressed ? styles.pressed : null]}
          testID="review-deck-segment-switch"
        >
          <Text {...mobileTextProps("control")} style={[styles.framedButtonText, { color: theme.onAccent }]}>
            {action}
          </Text>
        </Pressable>
        {footer}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  count: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "600"
  },
  dimmed: {
    opacity: 0.45
  },
  divider: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth
  },
  // Always reserved (in both segments), so the divider never moves the deck.
  dividerSlot: {
    justifyContent: "center",
    minHeight: 18
  },
  dividerText: {
    fontSize: 12,
    fontWeight: "600"
  },
  framed: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center",
    paddingHorizontal: 12
  },
  framedActions: {
    alignItems: "center",
    alignSelf: "stretch",
    // Room for the Undo toast hanging below (REVIEW_DECK_TOAST_RESERVE in ReviewDeck.tsx).
    paddingBottom: 84,
    position: "relative"
  },
  framedButton: {
    alignItems: "center",
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: 24
  },
  framedButtonText: {
    fontSize: 16,
    fontWeight: "700"
  },
  framedCopy: {
    maxWidth: 280,
    textAlign: "center"
  },
  framedTitle: {
    fontFamily: MOBILE_DISPLAY_FONT.bold,
    fontSize: 32,
    letterSpacing: -1,
    textAlign: "center"
  },
  label: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center"
  },
  name: {
    fontSize: 15,
    fontWeight: "600"
  },
  pressed: {
    opacity: 0.72
  },
  segment: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 38
  },
  thumb: {
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    bottom: TRACK_PADDING,
    left: TRACK_PADDING,
    position: "absolute",
    top: TRACK_PADDING
  },
  track: {
    borderRadius: DAYFRAME_BLOCKS.radius.pill,
    flexDirection: "row",
    minHeight: 44,
    padding: TRACK_PADDING
  }
});
