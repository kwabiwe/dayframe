import { Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { ParsedLocationReviewWindow } from "../../lib/locationReviewDraft";
import { mobileTextProps } from "../../lib/mobileTypography";

export function CommuteInterruptionPreview({
  startedAt,
  stoppedAt,
  stopWindow,
  styles
}: {
  startedAt: string;
  stoppedAt: string;
  stopWindow: ParsedLocationReviewWindow | null;
  styles: { splitSummary: ViewStyle; fieldLabel: TextStyle; helperText: TextStyle };
}) {
  const valid = stopWindow &&
    Date.parse(startedAt) < Date.parse(stopWindow.startedAt) &&
    Date.parse(stopWindow.startedAt) < Date.parse(stopWindow.stoppedAt) &&
    Date.parse(stopWindow.stoppedAt) < Date.parse(stoppedAt);
  const parts = [
    { label: "Journey 1", range: valid ? formatRange(startedAt, stopWindow.startedAt) : "Set both stop times" },
    { label: "Unassigned stop", range: valid ? formatRange(stopWindow.startedAt, stopWindow.stoppedAt) : "No time assigned" },
    { label: "Journey 2", range: valid ? formatRange(stopWindow.stoppedAt, stoppedAt) : "Set both stop times" }
  ];

  return (
    <View style={styles.splitSummary}>
      {parts.map(({ label, range }) => (
        <View key={label} accessible accessibilityRole="text" accessibilityLabel={`${label}. ${range}`}>
          <Text {...mobileTextProps("metadata")} style={styles.fieldLabel}>{label}</Text>
          <Text {...mobileTextProps("body")} style={styles.helperText}>{range}</Text>
        </View>
      ))}
    </View>
  );
}

function formatRange(startedAt: string, stoppedAt: string) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  return `${formatter.format(new Date(startedAt))} to ${formatter.format(new Date(stoppedAt))}`;
}
