import { useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { blockColorsFor, DAYFRAME_APP_ICONS, DAYFRAME_BLOCKS } from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import { recordMobileLayout, recordMobileTextLayout, type MobileAccessibilityDiagnostic } from "../accessibility/diagnostics";
import type { MobileTheme } from "../../lib/mobileTheme";
import { localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import { mobileTextProps } from "../../lib/mobileTypography";
import { todayReviewNudgeSplit } from "../../lib/todayReviewPresentation";
import { useTodayReviewPresentationContext } from "./TodayReviewPresentationContext";

const FOUND_TIME = "Dayframe found time you didn't track.";

export type ReviewNudgeCopy = {
  title: string;
  detail: string;
  /** What VoiceOver reads for the detail ("3 today, 9 earlier"). */
  spokenDetail: string;
  count: number | null;
  /** The Review segment the nudge opens: Today when it has moments, Earlier otherwise; null when unknown. */
  segment: "today" | "earlier" | null;
};

export type ReviewCount = { value: number | null; exact: boolean };

/**
 * What the nudge says. An exact count names the moments; an inexact or unavailable one never shows a
 * number it cannot vouch for. An exact zero hides the card: a Review decision zeroes the presentation
 * at once while the bootstrap's count lags until its next refresh. Only when the presentation read
 * has failed (so a newer bootstrap could not be read through) does a positive bootstrap count keep an
 * uncounted card.
 */
export function reviewNudgeCopy(
  outstanding: ReviewCount | null,
  fallback: ReviewCount,
  presentationReadFailed = false,
  /** The presentation's exact count of moments overlapping today, for the "3 today · 9 earlier" split. */
  today: ReviewCount | null = null
): ReviewNudgeCopy | null {
  const fallbackOpen = (fallback.value ?? 0) > 0;
  if (outstanding && outstanding.exact) {
    if (outstanding.value) return counted(outstanding.value, todayReviewNudgeSplit(outstanding, today));
    return presentationReadFailed && fallbackOpen ? UNCOUNTED : null;
  }
  if (outstanding && outstanding.value) return UNCOUNTED;
  if (fallbackOpen) return fallback.exact ? counted(fallback.value!) : UNCOUNTED;
  return null;
}

/**
 * A failed read only says a newer bootstrap could not be read through when the phone was online;
 * offline the Dashboard keeps its cached bootstrap, which is never newer than the cached presentation.
 */
export function readFailedOnline(errorKind: string | null | undefined) {
  return Boolean(errorKind) && errorKind !== "offline";
}

const UNCOUNTED: ReviewNudgeCopy = {
  count: null,
  detail: "Open Review for the latest items.",
  segment: null,
  spokenDetail: "Open Review for the latest items.",
  title: "Moments to review"
};

/** "3 today · 9 earlier", or plain words when one side is empty. */
export function reviewNudgeSplitCopy(split: { today: number; earlier: number }) {
  if (split.today && split.earlier) {
    return { detail: `${split.today} today · ${split.earlier} earlier`, spokenDetail: `${split.today} today, ${split.earlier} earlier` };
  }
  if (split.earlier) {
    const detail = split.earlier === 1 ? "From an earlier day" : "All from earlier days";
    return { detail, spokenDetail: detail };
  }
  const detail = split.today === 1 ? "From today" : "All from today";
  return { detail, spokenDetail: detail };
}

function counted(value: number, split: { today: number; earlier: number; segment: "today" | "earlier" } | null = null): ReviewNudgeCopy {
  const title = `${value} ${value === 1 ? "moment" : "moments"} to review`;
  if (!split) return { count: value, detail: FOUND_TIME, segment: null, spokenDetail: FOUND_TIME, title };
  return { count: value, segment: split.segment, title, ...reviewNudgeSplitCopy(split) };
}

/** "N moments to review" (Blocks prototype): one card that opens Review, replacing Today's donut and rows. */
export function TodayReviewNudge({
  diagnostic,
  fallback,
  onOpenReview,
  reduceMotion,
  theme,
}: {
  diagnostic?: MobileAccessibilityDiagnostic;
  /** The bootstrap's count; exact only when it is the server's total, not a capped list's length. */
  fallback: ReviewCount;
  /** Opens Review on the segment that has moments (null: the default, Today). */
  onOpenReview: (segment: "today" | "earlier" | null) => void;
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
  const copy = reviewNudgeCopy(
    presentation?.globalReviewCount ?? null,
    fallback,
    readFailedOnline(context?.errorKind),
    presentation?.todayReviewCount ?? null
  );
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
        accessibilityHint={copy.segment === "earlier" ? "Opens Review on earlier days" : "Opens Review"}
        accessibilityLabel={`${copy.title}. ${copy.spokenDetail}`}
        accessibilityRole="button"
        onLayout={(event) => recordMobileLayout(diagnostic, "review-nudge.card", event)}
        onPress={() => onOpenReview(copy.segment)}
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
  card: { alignItems: "center", borderRadius: DAYFRAME_BLOCKS.radius.phoneCard, flexDirection: "row", gap: 14, minHeight: 72, paddingHorizontal: 16, paddingVertical: 14 },
  pressed: { opacity: 0.82 },
  stack: { height: 44, width: 56 },
  stackBlock: { borderRadius: 8, height: 30, left: 6, position: "absolute", width: 40 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: "700" },
  detail: { fontSize: 12.5, lineHeight: 17 },
});
