import { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_APP_ICONS } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "../accessibility/diagnostics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import { mobileTextProps } from "../../lib/mobileTypography";
import { useTodayReviewPresentationContext } from "./TodayReviewPresentationContext";

const FOUND_TIME = "Dayframe found time you didn't track.";

export type ReviewNudgeCopy = { title: string; detail: string; count: number | null };

/**
 * What the nudge says. An exact count names the moments; an inexact or unavailable one never shows a
 * number it cannot vouch for, and only an exact zero hides the card.
 */
export function reviewNudgeCopy(
  outstanding: { value: number | null; exact: boolean } | null,
  fallbackCount: number
): ReviewNudgeCopy | null {
  if (outstanding && outstanding.exact) {
    if (!outstanding.value) return null;
    return {
      count: outstanding.value,
      detail: FOUND_TIME,
      title: `${outstanding.value} ${outstanding.value === 1 ? "moment" : "moments"} to review`,
    };
  }
  if (outstanding && outstanding.value) {
    return { count: null, detail: "Open Review for the latest items.", title: "Moments to review" };
  }
  if (fallbackCount > 0) {
    return {
      count: fallbackCount,
      detail: FOUND_TIME,
      title: `${fallbackCount} ${fallbackCount === 1 ? "moment" : "moments"} to review`,
    };
  }
  return null;
}

/** "N moments to review" (Blocks prototype): one card that opens Review, replacing Today's donut and rows. */
export function TodayReviewNudge({
  diagnostic,
  fallbackCount,
  onOpenReview,
  reduceMotion,
  theme,
}: {
  diagnostic?: MobileAccessibilityDiagnostic;
  fallbackCount: number;
  onOpenReview: () => void;
  reduceMotion: boolean;
  theme: MobileTheme;
}) {
  // No entrance on first paint or a cached launch; a nudge that arrives later fades in, and the
  // last decision fades it out while the parent's layout transition closes the gap.
  const painted = useRef(false);
  useEffect(() => {
    painted.current = true;
  }, []);
  const entering = useMemo(() => localPresenceEntering(reduceMotion), [reduceMotion]);
  const exiting = useMemo(() => localPresenceExiting(reduceMotion), [reduceMotion]);
  const context = useTodayReviewPresentationContext();
  const presentation = context?.isSummaryAvailable ? context.presentation : null;
  const copy = reviewNudgeCopy(presentation?.globalReviewCount ?? null, fallbackCount);
  if (!copy) return null;
  const colors = (presentation?.daySections ?? [])
    .flatMap((section) => section.activities)
    .filter((activity) => activity.awaitingDecision)
    .slice(0, 3)
    .map((activity) => activity.category?.color ?? activity.category?.name ?? null);
  const stack = colors.length ? colors : [null];

  return (
    <Reanimated.View entering={painted.current ? entering : undefined} exiting={exiting}>
      <Pressable
        accessibilityHint="Opens Review"
        accessibilityLabel={`${copy.title}. ${copy.detail}`}
        accessibilityRole="button"
        onLayout={(event) => recordMobileLayout(diagnostic, "review-nudge.card", event)}
        onPress={onOpenReview}
        style={({ pressed }) => [styles.card, { backgroundColor: theme.surface }, pressed ? styles.pressed : null]}
        testID="today-review-nudge"
      >
        <View style={styles.stack}>
          {stack.map((color, index) => (
            <View
              key={index}
              style={[
                styles.stackBlock,
                STACK_POSES[index],
                { backgroundColor: color ? blockColorsFor(color, theme.mode).fill : theme.surfaceMuted },
              ]}
            />
          ))}
        </View>
        <View style={styles.text}>
          <Text
            {...mobileTextProps("itemTitle")}
            onLayout={(event) => recordMobileLayout(diagnostic, "review-nudge.title.frame", event)}
            onTextLayout={(event) => recordMobileTextLayout(diagnostic, "review-nudge.title", event, "itemTitle", styles.title)}
            style={[styles.title, { color: theme.textPrimary }]}
          >
            {copy.title}
          </Text>
          <Text
            {...mobileTextProps("metadata")}
            onLayout={(event) => recordMobileLayout(diagnostic, "review-nudge.detail.frame", event)}
            onTextLayout={(event) => recordMobileTextLayout(diagnostic, "review-nudge.detail", event, "metadata", styles.detail)}
            style={[styles.detail, { color: theme.textSecondary }]}
          >
            {copy.detail}
          </Text>
        </View>
        <DayframeIcon color={theme.textMuted} glyph={DAYFRAME_APP_ICONS.next} size={20} />
      </Pressable>
    </Reanimated.View>
  );
}

const STACK_POSES = [
  { opacity: 0.55, top: 0, transform: [{ rotate: "-8deg" }] },
  { opacity: 0.8, top: 5, transform: [{ rotate: "5deg" }] },
  { opacity: 1, top: 10 },
] as const;

const styles = StyleSheet.create({
  card: { alignItems: "center", borderRadius: 22, flexDirection: "row", gap: 14, minHeight: 72, paddingHorizontal: 16, paddingVertical: 14 },
  pressed: { opacity: 0.82 },
  stack: { height: 44, width: 56 },
  stackBlock: { borderRadius: 8, height: 30, left: 6, position: "absolute", width: 40 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "700" },
  detail: { fontSize: 12.5, lineHeight: 17 },
});
