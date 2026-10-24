import { Redirect, useLocalSearchParams } from "expo-router";
import type { LocationTimeline } from "@dayframe/shared";
import { CalendarListView } from "@/components/calendar/CalendarListView";
import { useEffect, useMemo, useState } from "react";
import { LogBox, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DayframeCalendarView } from "../modules/dayframe-calendar";
import type { MobileBootstrap, MobileTimeEntry } from "@/lib/api";
import { useClockFormat } from "@/lib/clockFormat";
import { useMobileTheme } from "@/lib/mobileTheme";
import { buildNativeCalendarBridgeState } from "@/lib/nativeCalendarPresentation";

// Development-only harness for Calendar titles at every zoom (location v4 C6) and Calendar › List
// (step 9): the native Calendar and the List drawing the mock-ups' synthetic Exampleton Thursday
// (screens #ios-grid, #ios-grid-default and #ios-list), so the build can be compared with them side by
// side. `?layout=list` opens in List. No account, network or mutation.
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

// The List's places and trips for the same Thursday: Home, the school run's trip, an unknown place.
const iso = (hh: number, mm: number) => at(hh, mm);
const timeline: LocationTimeline = {
  date: DAY, timeZone: "Europe/London", dayStart: new Date(2026, 9, 22).toISOString(), dayEnd: new Date(2026, 9, 23).toISOString(),
  gaps: [], openTrip: null,
  items: [
    { kind: "place", id: "qa-home", status: "finalised", startedAt: new Date(2026, 9, 21, 22).toISOString(), stoppedAt: iso(8, 36),
      placeId: "p-home", learnedPlaceId: null, name: "Home", role: "home", matchKind: "saved", confidence: "high", blockIds: [] },
    { kind: "trip", id: "qa-trip-1", status: "finalised", startedAt: iso(8, 47), stoppedAt: iso(10, 39), fromId: "qa-school", toId: "qa-office",
      mode: "train", stopIds: [], distanceMeters: 21_000, confidence: "high", reason: null, blockIds: ["b2"], legs: [
        { startedAt: iso(8, 47), stoppedAt: iso(9, 2), mode: "walking", confidence: "sure", distanceMeters: 1_100 },
        { startedAt: iso(9, 10), stoppedAt: iso(10, 20), mode: "train", confidence: "likely", distanceMeters: 19_000 },
        { startedAt: iso(10, 24), stoppedAt: iso(10, 39), mode: "underground", confidence: "unsure", runnerUp: "train", distanceMeters: 900 }] },
    { kind: "place", id: "qa-school", status: "finalised", startedAt: iso(8, 36), stoppedAt: iso(8, 47), placeId: "p-school", learnedPlaceId: null,
      name: "Exampleton Primary", role: null, matchKind: "saved", confidence: "high", blockIds: ["b1"] },
    { kind: "place", id: "qa-office", status: "finalised", startedAt: iso(10, 39), stoppedAt: iso(14, 40), placeId: "p-office", learnedPlaceId: null,
      name: "Office", role: "work", matchKind: "saved", confidence: "high", blockIds: ["b3", "b4"] },
    { kind: "place", id: "qa-unknown", status: "finalised", startedAt: iso(16, 26), stoppedAt: iso(17, 0), placeId: null, learnedPlaceId: null,
      name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [] }
  ]
};

export default function CalendarQaRoute() {
  const params = useLocalSearchParams<{ layout?: string }>();
  const [layout, setLayout] = useState<"grid" | "list">(params.layout === "list" ? "list" : "grid");
  const [headerHeight, setHeaderHeight] = useState<number | null>(null);
  // Screenshots of the harness carry no development toasts; only while it is open (Codex r1 on #570).
  useEffect(() => {
    if (!__DEV__) return;
    LogBox.ignoreAllLogs(true);
    return () => LogBox.ignoreAllLogs(false);
  }, []);
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
  const shown = useMemo(() => ({ ...model, layout }), [layout, model]);
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} testID="calendar-qa">
      <View style={{ flex: 1 }}>
        <DayframeCalendarView
          model={shown}
          onChangeLayout={(event) => setLayout(event.nativeEvent.layout === "list" ? "list" : "grid")}
          onHeaderHeight={(event) => setHeaderHeight(Math.ceil(event.nativeEvent.height))}
          style={layout === "list" && headerHeight ? { height: headerHeight } : { flex: 1 }}
        />
        {layout === "list" ? (
          <View style={{ flex: 1 }}>
            <CalendarListView clockFormat={clockFormat} dayStartMs={model.dayStartMs} entries={model.entries} loggedLabel={model.loggedLabel}
              nowMs={now} onOpenEntry={() => undefined} onRefresh={() => undefined} reduceMotion={false} refreshing={false} theme={theme}
              timeline={timeline} />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
