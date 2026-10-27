import { Redirect, useLocalSearchParams } from "expo-router";
import type { LocationTimeline } from "@dayframe/shared";
import { CalendarListView } from "@/components/calendar/CalendarListView";
import { LocationCorrectionSheet, type LocationCorrectionTarget } from "@/components/calendar/LocationCorrectionSheet";
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
// side. `?layout=list` opens in List; `?day=dense` draws calendar-v3-mockup's synthetic Friday
// (Calendar v3, 24 Oct 2026; `&layout=list` shows its List rows); `&at=HH` opens it at that hour, and `&cycle=1` steps through the mock-up's
// windows (the header, 08:45, 10:30, 17:15, 20:00), 8 seconds each, for Simulator screenshots without
// taps. No account, network or mutation.
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

// calendar-v3-mockup's synthetic Friday (Calendar v3, owner 24 Oct 2026): [start, end, title, colour, extra].
// Suggestions are needs-review blocks; 0–1 minute blocks are moments. Synthetic places only.
const DENSE_DAY = "2026-10-23";
const denseAt = (hhmm: string) => {
  const [hh, mm, ss = 0] = hhmm.split(":").map(Number);
  return new Date(2026, 9, 23, hh, mm, ss).toISOString();
};
type DenseExtra = { review?: boolean; place?: string; trip?: string; tag?: string; health?: boolean; pattern?: boolean };
const DENSE: Array<[string, string, string, string, DenseExtra?]> = [
  ["01:00", "09:00", "On call overnight", "amber"],
  ["05:00", "06:30", "Gym", "lime", { place: "Peak Gym, Exampleton" }],
  ["06:30", "07:00", "Walk", "lime"],
  ["07:00", "08:00", "Meal prep", "teal"],
  ["08:15", "08:40", "School run", "orange", { trip: "Home → Exampleton Primary", pattern: true }],
  ["08:40", "08:41", "Take vitamins", "lime"],
  ["09:00", "10:20", "Quarterly plan", "blue"],
  ["09:00", "09:45", "Three-way sync", "violet", { tag: "planning" }],
  ["09:00", "09:05", "Inbox", "steel"],
  ["09:02", "09:06", "Reply to Sam", "teal"],
  ["09:05", "09:10", "Coffee", "sky"],
  ["10:30", "10:45", "House viewing — 12 Example Road", "amber"],
  ["10:55", "10:56", "Check the build", "teal"],
  ["11:00", "13:30", "Birthday party", "amber", { place: "4 Sample Street, ZZ1 1ZZ" }],
  ["11:00", "11:20", "Unknown place", "graphite", { review: true }],
  ["13:20", "13:40", "Pick up parcel", "blue"],
  ["15:00", "15:15", "Call with Alex", "violet"],
  ["17:30", "17:45", "Call someone", "blue"],
  ["18:00", "19:00", "Games night", "sky"],
  ["18:45", "19:05", "Bedtime routine", "rose"],
  ["19:15", "19:30", "Prep for next day", "blue"],
  ["20:00", "23:55", "Evening shift", "amber"],
  ["20:00", "20:40", "Stretch", "lime", { health: true }],
  ["20:00", "20:20", "Journal", "graphite", { review: true }],
  ["22:00", "22:45", "F1 qualifying", "rose", { place: "Exampleton Arena" }]
];
const QA_CYCLE_HOURS: Array<number | null> = [null, 8.75, 10.5, 17.25, 20];
const denseCategories = [...new Set(DENSE.map(([, , , color]) => color))].map((color) => ({ id: `colour-${color}`, name: color, color, isPinned: false }));
const denseEntries: MobileTimeEntry[] = DENSE.map(([start, end, title, color, extra = {}], index) => {
  const startedAt = denseAt(start);
  const stoppedAt = denseAt(end);
  return {
    id: `dense-${index}`,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: `colour-${color}`,
    categoryName: title,
    categoryColor: color,
    placeName: extra.place ?? extra.trip ?? null,
    automaticMoveEventId: extra.trip ? `qa-move-${index}` : null,
    source: extra.health ? "health_workout" : extra.review ? "location_learning" : "manual_app",
    confidence: extra.review ? "medium" : "high",
    reviewStatus: extra.review ? "needs_review" : "confirmed",
    description: title,
    startedAt,
    stoppedAt,
    durationSeconds: (Date.parse(stoppedAt) - Date.parse(startedAt)) / 1000,
    tagNames: extra.tag ? [extra.tag] : [],
    locationGroup: extra.pattern ? { key: "qa-school-run", name: "School run", parts: 1 } : null
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
// Their questions (step 14 part 3b), as reviewAnswerQuestion words them; answers here do nothing.
const QA_CHECK_QUESTIONS = new Map([
  ["qa-check-unknown", { question: "Log Unknown place, 16:26–17:00?", detail: null, logLabel: "Log it", skipLabel: "Not now", more: true, opens: false }],
  ["qa-check-sleep", { question: "Log your sleep, 23:10–06:50?", detail: "From Apple Health.", logLabel: "Log as Sleep", skipLabel: "Not sleep", more: false, opens: false }]
]);

// Step 12's correction sheets: the saved places, and the trip with no block (so its times and "This wasn't a
// trip" show), at the first leg view for `leg`.
const QA_SHEET_PLACES = [
  { id: "p-home", name: "Home", role: "home" },
  { id: "p-office", name: "Work", role: "work" },
  { id: "p-school", name: "Exampleton Primary", role: null }
];
function qaSheetTarget(sheet: string | undefined): LocationCorrectionTarget | null {
  const place = timeline.items.find((item) => item.id === "qa-unknown");
  const trip = timeline.items.find((item) => item.id === "qa-trip-1");
  if (sheet === "place" && place?.kind === "place") return { kind: "place", place, label: "Unknown place" };
  if ((sheet === "trip" || sheet === "leg") && trip?.kind === "trip") {
    return { kind: "trip", trip: { ...trip, blockIds: [], route: "Exampleton Primary → Office" }, legIndex: sheet === "leg" ? 2 : null };
  }
  return null;
}

export default function CalendarQaRoute() {
  // `?check=1` opens the List at its first "?" with its question showing, as Today's chip does.
  const params = useLocalSearchParams<{ layout?: string; day?: string; at?: string; cycle?: string; check?: string; sheet?: string }>();
  const [cycleStep, setCycleStep] = useState(0);
  useEffect(() => {
    if (params.cycle !== "1") return;
    const timer = setInterval(() => setCycleStep((step) => (step + 1) % QA_CYCLE_HOURS.length), 8_000);
    return () => clearInterval(timer);
  }, [params.cycle]);
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
    data: { categories: dense ? denseCategories : categories, entries: dense ? denseEntries : entries, dayEntries: dense ? denseEntries : entries, reviewItems: [] } as unknown as MobileBootstrap,
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
  if (dense && layout !== "list") {
    // The whole day at the default 72 points an hour, opened at `at` (the header when absent), so
    // Simulator screenshots of the mock-up's windows need no scrolling (the native view's own scroll
    // has nothing left to move).
    const header = headerHeight ?? 260;
    const opensAt = params.cycle === "1" ? QA_CYCLE_HOURS[cycleStep] : params.at ? Number(params.at) : null;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} testID="calendar-qa">
        <ScrollView key={cycleStep} contentOffset={{ x: 0, y: opensAt !== null && Number.isFinite(opensAt) ? header + opensAt * 72 - 12 : 0 }}>
          <DayframeCalendarView
            model={model}
            onChangeLayout={() => undefined}
            onHeaderHeight={(event) => setHeaderHeight(Math.ceil(event.nativeEvent.height))}
            // The native view also keeps the top safe area inside it: room for it, so 23:59 is drawn too.
            style={{ height: header + 24 * 72 + 80 }}
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
            <CalendarListView checkQuestions={dense ? undefined : QA_CHECK_QUESTIONS} checks={dense ? undefined : QA_CHECKS} checkTitles={dense ? undefined : QA_CHECK_TITLES}
              onAnswerCheck={() => undefined} onOpenCheck={() => undefined} scrollToFirstCheck={params.check ? 1 : undefined} clockFormat={clockFormat} dayEndMs={model.dayEndMs} dayStartMs={model.dayStartMs} entries={model.entries} loggedLabel={model.loggedLabel}
              nowMs={now} onOpenEntry={() => undefined} onRefresh={() => undefined} reduceMotion={false} refreshing={false} theme={theme}
              timeline={dense ? null : timeline} />
          </View>
        ) : null}
        {/* `?sheet=place|trip|leg` (step 12): a correction sheet open over the List, for Simulator screenshots. */}
        {qaSheetTarget(params.sheet) ? (
          <LocationCorrectionSheet clockFormat={clockFormat} onDismissed={() => undefined} onQueue={() => undefined} places={QA_SHEET_PLACES}
            presentationId={1} reduceMotion={false} rootHosted={false} target={qaSheetTarget(params.sheet)!} theme={theme} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}
