import { Pressable, Text, View } from "react-native";
import { paletteColorFor } from "@dayframe/shared";
import type { TodayActivity } from "@/lib/todayReviewPresentation";
import type { MobileStyles, MobileTheme } from "@/lib/mobileTheme";
import { mobileTextProps } from "@/lib/mobileTypography";

export function TodayReviewRow({
  activity,
  committing,
  message,
  nowMs,
  onOpen,
  onQuickConfirm,
  styles,
  theme
}: {
  activity: TodayActivity;
  committing: boolean;
  message: string | null;
  nowMs: number;
  onOpen: () => void;
  onQuickConfirm: () => void;
  styles: MobileStyles;
  theme: MobileTheme;
}) {
  const quickConfirm = activity.quickConfirm.eligible && activity.state === "needs_review";
  const badge = activityStateCopy(activity);
  const color = activity.category
    ? paletteColorFor(activity.category.color ?? activity.category.id, activity.category.name ?? "Uncategorized", theme.mode)
    : theme.textSecondary;
  const time = activity.interval
    ? `${formatTime(activity.interval.startMs)}-${formatTime(activity.interval.endMs)} · ${formatDuration(activity.interval.endMs - activity.interval.startMs)}`
    : activity.detectedAtMs
      ? `Detected ${formatDateTime(activity.detectedAtMs, nowMs)}`
      : "Detection time unavailable";
  const details = [activity.category?.name, activity.placeLabel].filter(Boolean).join(" · ");
  const openLabel = `${activity.title}. ${time}.${details ? ` ${details}.` : ""} ${badge}.`;

  return (
    <View testID={`today-review-row-${activity.presentationKey}`} style={styles.todayReviewRow}>
      <Pressable
        accessibilityLabel={openLabel}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.todayReviewRowMain, pressed ? styles.buttonPressed : null]}
      >
        <View style={styles.todayReviewRowHeader}>
          <View style={[styles.todayEntryDot, { backgroundColor: color }]} />
          <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={[styles.todayEntryTitle, { flex: 1, minWidth: 0 }]}>
            {activity.title}
          </Text>
          <View style={[
            styles.todayReviewStateBadge,
            activity.state === "needs_attention" ? styles.todayReviewStateBadgeAttention : null
          ]}>
            <Text
              {...mobileTextProps("counter")}
              style={[
                styles.todayReviewStateBadgeText,
                activity.state === "needs_attention" ? styles.todayReviewStateBadgeAttentionText : null
              ]}
            >
              {badge}
            </Text>
          </View>
        </View>
        <Text {...mobileTextProps("metadata")} style={styles.todayEntryMeta}>{time}</Text>
        {details ? <Text {...mobileTextProps("metadata")} numberOfLines={2} style={styles.todayEntryOptionalMeta}>{details}</Text> : null}
        {message ? <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={styles.todayReviewInlineError}>{message}</Text> : null}
      </Pressable>
      {quickConfirm ? (
        <Pressable
          accessibilityHint="Saves the shown Review proposal on this iPhone."
          accessibilityLabel={`Confirm ${activity.title}, ${time}`}
          accessibilityRole="button"
          accessibilityState={{ busy: committing, disabled: committing }}
          disabled={committing}
          onPress={onQuickConfirm}
          style={({ pressed }) => [
            styles.todayReviewCheck,
            committing ? styles.buttonDisabled : null,
            pressed && !committing ? styles.buttonPressed : null
          ]}
        >
          <Text accessible={false} style={styles.todayReviewCheckText}>✓</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function activityStateCopy(activity: TodayActivity) {
  if (activity.state === "accepted_locally") return activity.resolution === "verified"
    ? "Saved on this iPhone"
    : "Confirmation syncing";
  if (activity.state === "needs_attention") return activity.resolution === "unknown"
    ? "Sync needs review"
    : "Needs attention";
  return "Needs review";
}

function formatTime(value: number) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(value: number, nowMs: number) {
  const date = new Date(value);
  const today = new Date(nowMs);
  const dateCopy = date.toDateString() === today.toDateString()
    ? "today"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${dateCopy} at ${formatTime(value)}`;
}

function formatDuration(valueMs: number) {
  const seconds = Math.max(0, Math.floor(valueMs / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
