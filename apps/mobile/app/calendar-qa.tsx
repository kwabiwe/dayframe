import { Redirect } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DayframeCalendarView } from "../modules/dayframe-calendar";
import type { MobileBootstrap, MobileTimeEntry } from "@/lib/api";
import { useClockFormat } from "@/lib/clockFormat";
import { useMobileTheme } from "@/lib/mobileTheme";
import { buildNativeCalendarBridgeState } from "@/lib/nativeCalendarPresentation";

// Development-only harness for Calendar titles at every zoom (location v4 C6): the native Calendar
// drawing the mock-ups' synthetic Exampleton Thursday (screens #ios-grid and #ios-grid-default), so
// the build can be compared with them side by side. No account, network or mutation.
const DAY = "2026-10-22";
const at = (hh: number, mm: number) => new Date(2026, 9, 22, hh, mm).toISOString();
const categories = [
  { id: "family", name: "Family", color: "rose", isPinned: false },
  { id: "around", name: "Getting around", color: "orange", isPinned: false },
  { id: "deep", name: "Deep work", color: "blue", isPinned: false },
  { id: "meeting", name: "Meeting", color: "violet", isPinned: false },
  { id: "social", name: "Social", color: "sky", isPinned: false }
];
const block = (id: string, category: string, description: string | null, start: [number, number], end: [number, number]): MobileTimeEntry => {
  const startedAt = at(...start);
  const stoppedAt = at(...end);
  const found = categories.find((item) => item.id === category)!;
  return {
    id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: found.id,
    categoryName: found.name,
    categoryColor: found.color,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description,
    startedAt,
    stoppedAt,
    durationSeconds: (Date.parse(stoppedAt) - Date.parse(startedAt)) / 1000,
    tagNames: []
  };
};
const entries = [
  block("b1", "family", "School run", [8, 36], [8, 47]),
  block("b2", "around", null, [8, 47], [10, 39]),
  block("b3", "deep", "Quarterly plan", [10, 45], [12, 30]),
  block("b6", "meeting", "Call with Sam", [11, 30], [11, 45]),
  block("b7", "social", "Coffee", [12, 30], [12, 34]),
  block("b4", "meeting", "Team sync", [13, 30], [14, 40]),
  block("b5", "around", null, [14, 40], [16, 26])
];

export default function CalendarQaRoute() {
  const { theme } = useMobileTheme();
  const clockFormat = useClockFormat();
  const [now] = useState(() => new Date(2026, 9, 22, 17, 5).getTime());
  const model = useMemo(() => buildNativeCalendarBridgeState({
    clockFormat,
    data: { categories, entries, dayEntries: entries, reviewItems: [] } as unknown as MobileBootstrap,
    now,
    reduceMotion: false,
    reduceTransparency: false,
    refreshing: false,
    selectedDayKey: DAY,
    theme,
    transitionDirection: 1
  }).model, [clockFormat, now, theme]);
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} testID="calendar-qa">
      <View style={{ flex: 1 }}>
        <DayframeCalendarView model={model} style={{ flex: 1 }} />
      </View>
    </SafeAreaView>
  );
}
