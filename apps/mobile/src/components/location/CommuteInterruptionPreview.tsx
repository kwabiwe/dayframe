import { Text, View, type TextStyle, type ViewStyle } from "react-native";
import type { CommuteInterruptionDraftResult } from "../../lib/commuteInterruptionDraft";
import { mobileTextProps } from "../../lib/mobileTypography";

export function CommuteInterruptionPreview({
  startedAt,
  stoppedAt,
  interruption,
  styles
}: {
  startedAt: string;
  stoppedAt: string;
  interruption: CommuteInterruptionDraftResult;
  styles: { splitSummary: ViewStyle; fieldLabel: TextStyle; helperText: TextStyle };
}) {
  const mutation = interruption.mutation;
  const guidance = interruption.status === "invalid" ? interruption.error : "Set both stop times";
  const parts = [
    { label: "Journey 1", range: mutation ? formatRange(startedAt, mutation.stopStartedAt) : guidance },
    { label: "Unassigned stop", range: mutation ? formatRange(mutation.stopStartedAt, mutation.stopEndedAt) : "No time assigned" },
    { label: "Journey 2", range: mutation ? formatRange(mutation.stopEndedAt, stoppedAt) : guidance }
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
