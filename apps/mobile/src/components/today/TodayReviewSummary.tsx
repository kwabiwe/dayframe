import { Pressable, Text, View } from "react-native";
import { pressable, useMobileTheme } from "@/lib/mobileTheme";
import { useResolvedReduceMotionPreference } from "@/lib/motion";
import { mobileTextProps } from "@/lib/mobileTypography";
import { useTodayReviewPresentationContext } from "./TodayReviewPresentationContext";
import { TodayReviewDonut } from "./TodayReviewDonut";

export function TodayReviewSummary({ isFocused }: { isFocused: boolean }) {
  const context = useTodayReviewPresentationContext();
  const { styles, theme } = useMobileTheme();
  const { reduceMotion } = useResolvedReduceMotionPreference();
  if (!context?.isSummaryAvailable || !context.presentation) return null;
  const presentation = context.presentation;
  const activities = presentation.daySections.flatMap((section) => section.activities);
  const outstanding = presentation.globalReviewCount;
  const today = presentation.todayReviewCount;
  const hideOpenReview = presentation.coverage === "complete" && outstanding.exact && outstanding.value === 0;

  return (
    <View testID="today-review-summary" style={styles.todayReviewSummary}>
      <TodayReviewDonut
        key={`${context.owner?.backendId ?? "none"}:${context.owner?.workspaceId ?? "none"}:${context.owner?.userId ?? "none"}:${presentation.dayKey}`}
        activities={activities}
        animateEntrance={isFocused}
        completedLoggedMs={presentation.completedLoggedMs}
        isFocused={isFocused}
        onOpenActivity={context.openActivity}
        reduceMotion={reduceMotion}
        segments={presentation.donutSegments}
        theme={theme}
      />
      {presentation.awaitingReviewMs > 0 ? (
        <Text {...mobileTextProps("numeric")} style={styles.todayReviewAwaiting}>
          + {formatDuration(presentation.awaitingReviewMs)} awaiting review
        </Text>
      ) : null}
      {presentation.savedConfirmationCount > 0 ? (
        <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={styles.todayReviewSaved}>
          {presentation.savedConfirmationCount} {presentation.savedConfirmationCount === 1 ? "confirmation" : "confirmations"} syncing
        </Text>
      ) : null}
      {context.error ? (
        <Text {...mobileTextProps("metadata")} style={styles.todayReviewSaved}>{context.error}</Text>
      ) : null}
      {!hideOpenReview ? (
        <Pressable
          accessibilityLabel={openReviewAccessibilityLabel(outstanding, today)}
          accessibilityRole="button"
          onPress={context.openReview}
          style={pressable(styles.todayReviewOpenButton, styles.buttonPressed)}
        >
          <Text {...mobileTextProps("control")} style={styles.todayReviewOpenTitle}>Open Review</Text>
          <Text {...mobileTextProps("metadata")} style={styles.todayReviewOpenMeta}>
            {openReviewCopy(outstanding, today)}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function openReviewCopy(
  outstanding: { value: number | null; exact: boolean },
  today: { value: number | null; exact: boolean }
) {
  if (outstanding.value === null) return "Review availability is limited";
  if (!outstanding.exact || !today.exact) return "Open Review for the latest available items";
  const global = `${outstanding.value} ${outstanding.value === 1 ? "item" : "items"} to review`;
  const todayCopy = today.value === 0 ? "None today" : `${today.value} today`;
  return `${global} · ${todayCopy}`;
}

function openReviewAccessibilityLabel(
  outstanding: { value: number | null; exact: boolean },
  today: { value: number | null; exact: boolean }
) {
  return `Open Review. ${openReviewCopy(outstanding, today)}.`;
}

function formatDuration(valueMs: number) {
  const seconds = Math.max(0, Math.floor(valueMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
