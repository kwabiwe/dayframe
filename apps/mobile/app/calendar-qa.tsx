import { Redirect, useLocalSearchParams } from "expo-router";
import type { LocationTimeline } from "@dayframe/shared";
import { CalendarListView } from "@/components/calendar/CalendarListView";
import { useEffect, useMemo, useState } from "react";
import { LogBox, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DayframeCalendarView } from "../modules/dayframe-calendar";
import type { MobileBootstrap, MobileTimeEntry } from "@/lib/api";
import { useClockFormat } from "@/lib/clockFormat";
import { useMobileTheme } from "@/lib/mobileTheme";
import { buildNativeCalendarBridgeState } from "@/lib/nativeCalendarPresentation";

// Development-only harness for Calendar titles at every zoom (location v4 C6) and Calendar › List
// (step 9): the native Calendar and the List drawing the mock-ups' synthetic Exampleton Thursday
// (screens #ios-grid, #ios-grid-default and #ios-list), so the build can be compared with them side by
// side. `?layout=list` opens in List; `?day=dense` draws calendar-dense-mockup v2's synthetic Friday
// (dense-day rules, 24 Oct 2026). No account, network or mutation.
const DAY = "2026-10-22";
const at = (hh: number, mm: number) => new Date(2026, 9, 22, hh, mm).toISOString();
const categories = [
  { id: "family", name: "Family", color: "rose", isPinned: false },
  { id: "around", name: "Getting around", color: "orange", isPinned: false },
  { id: "deep", name: "Deep work", color: "blue", isPinned: false },
  { id: "meeting", name: "Meeting", color: "violet", isPinned: false },
  { id: "social", name: "Social", color: "sky", isPinned: false },
  { id: "health", name: "Health", color: "lime", isPinned: false },
  { id: "personal", name: "Personal", color: "teal", isPinned: false },
  { id: "admin", name: "Admin", color: "steel", isPinned: false },
  { id: "errand", name: "Errands", color: "amber", isPinned: false }
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

// calendar-dense-mockup v2's Friday: [start, end, title, activity, kind]. Suggestions are needs-review
// blocks; the school run is a named pattern's three parts; 0–1 minute blocks are moments.
const DENSE_DAY = "2026-10-23";
const denseAt = (hhmm: string) => {
  const [hh, mm, ss = 0] = hhmm.split(":").map(Number);
  return new Date(2026, 9, 23, hh, mm, ss).toISOString();
};
const DENSE: Array<[string, string, string, string, ("review" | "pattern")?]> = [
  ["07:05", "07:40", "Morning routine", "family"],
  ["07:40", "07:41", "Take vitamins", "health"],
  ["07:42", "08:01", "Getting around", "around", "pattern"],
  ["08:01", "08:21", "School run", "family", "pattern"],
  ["08:21", "08:40", "Getting around", "around", "pattern"],
  ["08:40", "08:44", "Coffee", "social"],
  ["08:45", "11:50", "Quarterly plan", "deep"],
  ["09:00", "09:15", "Standup", "meeting"],
  ["09:30", "09:34", "Reply to Sam", "personal"],
  ["09:40", "10:10", "Design review", "meeting"],
  ["09:45", "10:05", "Supplier call", "meeting"],
  ["10:20", "10:23", "Expense receipts", "personal"],
  ["10:25", "10:55", "Inbox and admin", "admin"],
  ["11:00", "11:00:30", "Check the build", "personal"],
  ["11:05", "11:20", "1:1 with Priya", "meeting"],
  ["12:00", "12:40", "Lunch", "health"],
  ["12:10", "12:35", "Unknown place", "admin", "review"],
  ["12:45", "13:15", "Walk", "health", "review"],
  ["13:15", "14:45", "Customer workshop", "meeting"],
  ["13:20", "13:50", "QA24 notes", "personal"],
  ["14:00", "14:05", "Quick sync", "meeting"],
  ["14:50", "15:20", "Getting around", "around"],
  ["15:20", "15:28", "Pick up parcel", "errand"],
  ["15:30", "17:10", "Write proposal", "deep"],
  ["15:45", "16:00", "Call with Alex", "meeting"],
  ["16:30", "16:34", "Water plants", "health"],
  ["17:10", "17:40", "Getting around", "around", "review"],
  ["17:45", "18:30", "Family dinner", "family"],
  ["18:30", "18:31", "Log mood", "health"],
  ["18:35", "19:20", "Gym", "health", "review"]
];
const denseEntries: MobileTimeEntry[] = DENSE.map(([start, end, title, category, kind], index) => {
  const found = categories.find((item) => item.id === category)!;
  const startedAt = denseAt(start);
  const stoppedAt = denseAt(end);
  return {
    id: `dense-${index}`,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: found.id,
    categoryName: found.name,
    categoryColor: found.color,
    placeName: null,
    source: kind ? "location_learning" : "manual_app",
    confidence: kind === "review" ? "medium" : "high",
    reviewStatus: kind === "review" ? "needs_review" : "confirmed",
    description: title,
    startedAt,
    stoppedAt,
    durationSeconds: (Date.parse(stoppedAt) - Date.parse(startedAt)) / 1000,
    tagNames: [],
    locationGroup: kind === "pattern" ? { key: "qa-school-run", name: "School run", parts: 3 } : null
  };
});

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

// Things to check (step 14): the unknown place's question, and Apple Health's sleep.
const QA_CHECKS = [
  { id: "qa-check-unknown", segmentId: "qa-unknown", startedAt: iso(16, 26), stoppedAt: iso(17, 0) },
  { id: "qa-check-sleep", segmentId: null, startedAt: new Date(2026, 9, 21, 23, 10).toISOString(), stoppedAt: iso(6, 50) }
];
const QA_CHECK_TITLES = new Map([["qa-check-unknown", "Unknown place"], ["qa-check-sleep", "Sleep"]]);

export default function CalendarQaRoute() {
  const params = useLocalSearchParams<{ layout?: string; day?: string }>();
  const dense = params.day === "dense";
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
  const [now] = useState(() => dense ? new Date(2026, 9, 23, 16, 20).getTime() : new Date(2026, 9, 22, 17, 5).getTime());
  const model = useMemo(() => buildNativeCalendarBridgeState({
    clockFormat,
    data: { categories, entries: dense ? denseEntries : entries, dayEntries: dense ? denseEntries : entries, reviewItems: [] } as unknown as MobileBootstrap,
    now,
    reduceMotion: false,
    reduceTransparency: false,
    refreshing: false,
    selectedDayKey: dense ? DENSE_DAY : DAY,
    theme,
    transitionDirection: 1
  }).model, [clockFormat, dense, now, theme]);
  const shown = useMemo(() => ({ ...model, layout }), [layout, model]);
  if (!__DEV__) return <Redirect href="/" />;
  if (dense) {
    // The whole day at the default 72 points an hour, opened at 07:00, so Simulator screenshots of the
    // mock-up's window need no scrolling (the native view's own scroll has nothing left to move).
    const header = headerHeight ?? 260;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} testID="calendar-qa">
        <ScrollView contentOffset={{ x: 0, y: header + 7 * 72 - 12 }}>
          <DayframeCalendarView
            model={model}
            onChangeLayout={() => undefined}
            onHeaderHeight={(event) => setHeaderHeight(Math.ceil(event.nativeEvent.height))}
            style={{ height: header + 24 * 72 + 8 }}
          />
        </ScrollView>
      </SafeAreaView>
    );
  }
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
            <CalendarListView checks={QA_CHECKS} checkTitles={QA_CHECK_TITLES} onOpenCheck={() => undefined} clockFormat={clockFormat} dayEndMs={model.dayEndMs} dayStartMs={model.dayStartMs} entries={model.entries} loggedLabel={model.loggedLabel}
              nowMs={now} onOpenEntry={() => undefined} onRefresh={() => undefined} reduceMotion={false} refreshing={false} theme={theme}
              timeline={timeline} />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
