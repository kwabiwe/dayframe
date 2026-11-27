import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileTheme } from "@/lib/mobileTheme";
import type { NativeCalendarPresentationEntry } from "@/lib/nativeCalendarPresentation";

export function calendarInspectorWidth(windowWidth: number, fontScale: number) {
  const minimum = fontScale >= 1.5 ? 850 : 700;
  return windowWidth >= minimum ? Math.min(320, Math.round(windowWidth * 0.32)) : 0;
}

export function CalendarDayInspector({ title, entries, total, theme, width, onOpen }: {
  title: string;
  entries: readonly NativeCalendarPresentationEntry[];
  total: string;
  theme: MobileTheme;
  width: number;
  onOpen: (entry: NativeCalendarPresentationEntry) => void;
}) {
  return (
    <View style={[styles.pane, { width, backgroundColor: theme.surface, borderLeftColor: theme.border }]}
      testID="calendar-day-inspector">
      <Text accessibilityRole="header" style={[styles.heading, { color: theme.textPrimary }]}>{title}</Text>
      <Text style={{ color: theme.textSecondary }}>{total}</Text>
      <FlatList
        data={entries.filter((entry) => !entry.isReview)}
        keyExtractor={(entry) => entry.actionId}
        contentContainerStyle={styles.rows}
        ListEmptyComponent={<Text style={{ color: theme.textSecondary }}>No logged blocks for this day.</Text>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={item.accessibilityLabel} onPress={() => onOpen(item)}
            style={[styles.row, { backgroundColor: theme.surfaceMuted }]}>
            <View style={[styles.mark, { backgroundColor: item.color }]} accessibilityElementsHidden />
            <View style={styles.labels}>
              <Text style={[styles.name, { color: theme.textPrimary }]}>{item.title}</Text>
              {item.meta ? <Text style={{ color: theme.textSecondary }}>{item.meta}</Text> : null}
              {item.placeText ? <Text style={{ color: theme.textSecondary }}>{item.placeText}</Text> : null}
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { padding: 16, gap: 6, borderLeftWidth: StyleSheet.hairlineWidth },
  heading: { fontSize: 20, fontWeight: "700" },
  rows: { gap: 8, paddingTop: 10, paddingBottom: 80 },
  row: { padding: 10, minHeight: 44, borderRadius: 12, flexDirection: "row", gap: 10 },
  mark: { width: 4, borderRadius: 2 },
  labels: { flex: 1, gap: 3 },
  name: { fontWeight: "600" }
});
