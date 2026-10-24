import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_BLOCKS,
  DAYFRAME_LEG_MODE_ICONS,
  formatClockTime,
  formatDuration,
  hasLocationPlaces,
  legDetail,
  legModeLabel,
  locationListRows,
  tripsByBlockId,
  type ClockFormat,
  type DayframeGlyph,
  type LocationListRow,
  type LocationTimeline,
  type TripLeg
} from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import type { NativeCalendarPresentationEntry } from "../../lib/nativeCalendarPresentation";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { formatLocaleDate } from "../../lib/localeDateFormat";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "../../lib/motion";

/**
 * Calendar › List on the iPhone (location v4 step 9, mock-up #ios-list, placement A): the day's blocks
 * in time order, with location only where it adds something — a place you weren't in a block at for
 * ten minutes (one row), the journey in progress, and a trip block's route and legs (opening into leg
 * rows). "Show Home and every place" adds Home and logged places as faint rows. Read-only: the "?"
 * questions and corrections come with later steps. Rows come from the shared rules the web List uses.
 *
 * Motion: a trip's legs and the faint rows enter and leave with the app's local presence (fade), and
 * the rows below move with its layout transition (220 ms); with Reduce Motion they appear at once.
 */

type ListItem =
  | { kind: "block"; key: string; atMs: number; entry: NativeCalendarPresentationEntry }
  | { kind: "location"; key: string; atMs: number; row: LocationListRow };

export function CalendarListView({
  clockFormat,
  dayStartMs,
  entries,
  loggedLabel,
  nowMs,
  onOpenEntry,
  onRefresh,
  reduceMotion,
  refreshing,
  theme,
  timeline
}: {
  clockFormat: ClockFormat;
  /** The shown day's start: the line reads its date ("Thu 22 Oct"), as the mock-up's day line does. */
  dayStartMs: number;
  entries: readonly NativeCalendarPresentationEntry[];
  /** The day's logged time ("7h 3m"). */
  loggedLabel: string;
  nowMs: number;
  onOpenEntry: (entry: NativeCalendarPresentationEntry) => void;
  onRefresh: () => void;
  reduceMotion: boolean;
  refreshing: boolean;
  theme: MobileTheme;
  timeline: LocationTimeline | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const [openLegs, setOpenLegs] = useState<ReadonlySet<string>>(() => new Set());
  // The day's blocks (Review suggestions stay on the Grid and Review for now).
  const blocks = useMemo(() => entries.filter((entry) => !entry.isReview), [entries]);
  const trips = useMemo(() => tripsByBlockId(timeline), [timeline]);
  const items = useMemo<ListItem[]>(() => {
    const intervals = blocks.map((entry) => ({
      startedAt: new Date(entry.startedAtMs).toISOString(),
      stoppedAt: entry.stoppedAtMs == null ? null : new Date(entry.stoppedAtMs).toISOString()
    }));
    const rows = locationListRows(timeline, intervals, { nowMs, showAll });
    // Oldest first, as the mock-up's day reads.
    return [
      ...blocks.map((entry): ListItem => ({ kind: "block", key: `block-${entry.entryId}`, atMs: entry.startedAtMs, entry })),
      ...rows.map((row): ListItem => ({ kind: "location", key: row.key, atMs: row.atMs, row }))
    ].sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
  }, [blocks, nowMs, showAll, timeline]);
  const time = (ms: number) => formatClockTime(new Date(ms), clockFormat);
  const toggleLegs = (id: string) => setOpenLegs((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl colors={[theme.accent]} onRefresh={onRefresh} refreshing={refreshing} tintColor={theme.accent} />}
      style={{ backgroundColor: theme.background }}
      testID="calendar-list"
    >
      <View style={styles.dayLine}>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.dayTitle, { color: theme.textPrimary }]}>
          {formatLocaleDate(new Date(dayStartMs), { weekday: "short", day: "numeric", month: "short" })}
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.dayMeta, { color: theme.textSecondary }]}>{loggedLabel} logged</Text>
      </View>
      <Animated.View layout={localLayoutTransition(reduceMotion)} style={[styles.card, { backgroundColor: theme.surface }]}>
        {items.length === 0 ? (
          <Text {...mobileTextProps("body")} style={[styles.empty, { color: theme.textSecondary }]}>Nothing framed yet.</Text>
        ) : items.map((item, index) => {
          const divider = index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border } : null;
          if (item.kind === "block") {
            const trip = trips.get(item.entry.entryId);
            const open = openLegs.has(item.entry.entryId);
            return (
              <Animated.View key={item.key} layout={localLayoutTransition(reduceMotion)} style={divider}>
                <BlockRow entry={item.entry} legsOpen={open} onOpen={() => onOpenEntry(item.entry)}
                  onToggleLegs={trip ? () => toggleLegs(item.entry.entryId) : undefined} route={trip?.route} legs={trip?.legs} theme={theme} />
                {trip && open ? (
                  <Animated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}>
                    <LegRows legs={trip.legs} theme={theme} time={time} />
                  </Animated.View>
                ) : null}
              </Animated.View>
            );
          }
          return (
            <Animated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} key={item.key}
              layout={localLayoutTransition(reduceMotion)} style={divider}>
              <LocationRow row={item.row} theme={theme} time={time} />
            </Animated.View>
          );
        })}
      </Animated.View>
      {hasLocationPlaces(timeline) ? (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: showAll }} onPress={() => setShowAll((current) => !current)}
          style={({ pressed }) => [styles.toggle, { backgroundColor: showAll ? theme.textPrimary : theme.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}>
          <Text {...mobileTextProps("control")} style={[styles.toggleText, { color: showAll ? theme.surface : theme.textSecondary }]}>
            {showAll ? "Hide Home and logged places" : "Show Home and every place"}
          </Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function BlockRow({ entry, legs, legsOpen, onOpen, onToggleLegs, route, theme }: {
  entry: NativeCalendarPresentationEntry; legs?: readonly TripLeg[]; legsOpen: boolean; onOpen: () => void;
  onToggleLegs?: () => void; route?: string; theme: MobileTheme;
}) {
  return (
    <View style={styles.row}>
      <Pressable accessibilityHint="Opens the block" accessibilityLabel={entry.accessibilityLabel} accessibilityRole="button" onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={[styles.mark, { backgroundColor: entry.color }]}>
          <DayframeIcon color={entry.textColor} glyph={entry.glyph as DayframeGlyph} size={18} />
        </View>
        <View style={styles.text}>
          <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={[styles.title, { color: theme.textPrimary }]}>{entry.title}</Text>
          <Text {...mobileTextProps("metadata")} numberOfLines={2} style={[styles.meta, { color: theme.textSecondary }]}>{entry.meta}</Text>
          {legs?.length ? <ModesLine legs={legs} route={route} theme={theme} /> : null}
        </View>
        <Text {...mobileTextProps("numeric")} style={[styles.length, { color: theme.textPrimary }]}>{entry.lengthLabel}</Text>
      </Pressable>
      {onToggleLegs ? (
        <Pressable accessibilityLabel={`${legsOpen ? "Hide" : "Show"} the legs of ${entry.title}`} accessibilityRole="button"
          accessibilityState={{ expanded: legsOpen }} hitSlop={6} onPress={onToggleLegs} style={styles.chevron}>
          <View style={{ transform: [{ rotate: legsOpen ? "270deg" : "90deg" }] }}>
            <DayframeIcon color={theme.textSecondary} glyph="chevron-right" size={16} />
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A trip's route and modes on one line; an unsure leg's name in amber with its "?". */
function ModesLine({ legs, route, theme }: { legs: readonly TripLeg[]; route?: string; theme: MobileTheme }) {
  return (
    <View accessibilityLabel={`${route ? `${route}. ` : ""}Legs: ${legs.map((leg) => legModeLabel(leg)).join(", ")}`} accessible style={styles.modes}>
      {route ? <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{route}</Text> : null}
      {legs.map((leg, index) => (
        <View key={`${leg.startedAt}-${index}`} style={styles.mode}>
          <DayframeIcon color={leg.confidence === "unsure" ? theme.warningText : theme.textSecondary} glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={13} />
          <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: leg.confidence === "unsure" ? theme.warningText : theme.textSecondary }]}>
            {legModeLabel({ ...leg, runnerUp: undefined })}
          </Text>
        </View>
      ))}
    </View>
  );
}

function LegRows({ legs, theme, time }: { legs: readonly TripLeg[]; theme: MobileTheme; time: (ms: number) => string }) {
  return (
    <View accessibilityLabel="Legs" style={styles.legs}>
      {legs.map((leg, index) => {
        const minutes = Math.max(0, Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000));
        const detail = legDetail(leg);
        return (
          <View key={`${leg.startedAt}-${index}`} style={[styles.leg, { backgroundColor: theme.surfaceMuted }]}>
            <DayframeIcon color={leg.confidence === "unsure" ? theme.warningText : theme.textSecondary} glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={16} />
            <View style={styles.text}>
              <Text {...mobileTextProps("itemTitle")} style={[styles.legTitle, { color: leg.confidence === "unsure" ? theme.warningText : theme.textPrimary }]}>
                {legModeLabel(leg)} · {formatDuration(minutes)}
              </Text>
              {detail ? <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{detail}</Text> : null}
            </View>
            <Text {...mobileTextProps("numeric")} style={[styles.meta, { color: theme.textSecondary }]}>{time(Date.parse(leg.startedAt))}</Text>
          </View>
        );
      })}
    </View>
  );
}

function LocationRow({ row, theme, time }: { row: LocationListRow; theme: MobileTheme; time: (ms: number) => string }) {
  if (row.kind === "open_trip") {
    return (
      <View accessible accessibilityLabel={`Travelling since ${time(Date.parse(row.startedAt))}. Logs when you arrive.`} style={styles.rowMain}>
        <View style={[styles.mark, { backgroundColor: theme.surfaceMuted }]}>
          <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.openTrip} size={18} />
        </View>
        <View style={styles.text}>
          <Text {...mobileTextProps("itemTitle")} style={[styles.title, { color: theme.textPrimary }]}>At {time(Date.parse(row.startedAt))}</Text>
          <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>
            Travelling from {row.fromName ?? "Unknown place"} · so far
          </Text>
          {row.legs.length ? <ModesLine legs={row.legs} theme={theme} /> : null}
        </View>
        <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textMuted }]}>Logs when you arrive</Text>
      </View>
    );
  }
  if (row.kind !== "place") return null;
  const { place } = row;
  const label = place.name ?? (place.matchKind === "ambiguous" ? "Unclear place" : "Unknown place");
  const open = place.stoppedAt == null;
  const span = open ? `since ${time(row.fromMs)}` : `${time(row.fromMs)}–${time(row.spanEndMs)}`;
  if (row.faint) {
    const glyph = place.role === "home" ? DAYFRAME_APP_ICONS.placeHome : place.role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places;
    const note = row.unloggedSeconds < 60 ? "logged" : place.role === "home" ? "not logged" : `${formatDuration(row.unloggedSeconds)} not logged`;
    return (
      <View accessible accessibilityLabel={`${label}, ${span}, ${note}`} style={[styles.rowMain, styles.faint]}>
        <View style={[styles.mark, { backgroundColor: theme.surfaceMuted }]}><DayframeIcon color={theme.textMuted} glyph={glyph} size={18} /></View>
        <Text {...mobileTextProps("metadata")} style={[styles.text, styles.meta, { color: theme.textSecondary }]}>{label} · {span}</Text>
        <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textMuted }]}>{note}</Text>
      </View>
    );
  }
  const length = Math.max(0, Math.round((row.spanEndMs - row.fromMs) / 1000));
  return (
    <View accessible accessibilityLabel={`${label}, ${formatDuration(row.unloggedSeconds)} not in a block, ${span}`} style={styles.rowMain}>
      <View style={[styles.mark, styles.unknownMark, { backgroundColor: theme.surfaceMuted, borderColor: theme.warning }]}>
        <DayframeIcon color={theme.warningText} glyph={DAYFRAME_APP_ICONS.placeUnknown} size={18} />
      </View>
      <View style={styles.text}>
        <Text {...mobileTextProps("itemTitle")} style={[styles.title, { color: theme.textPrimary }]}>{label}</Text>
        <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>
          {formatDuration(row.unloggedSeconds)} not in a block
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{span}</Text>
      </View>
      <Text {...mobileTextProps("numeric")} style={[styles.length, { color: theme.textSecondary }]}>{formatDuration(length)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 140, gap: 12 },
  dayLine: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 4, paddingTop: 4 },
  dayTitle: { fontSize: 20, fontWeight: "800" },
  dayMeta: { fontSize: 13, fontWeight: "600" },
  card: { borderRadius: DAYFRAME_BLOCKS.radius.phoneCard, overflow: "hidden" },
  empty: { padding: 20, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center" },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  faint: { opacity: 0.85, minHeight: 48, paddingVertical: 8 },
  mark: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  unknownMark: { borderWidth: 1.5 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 13 },
  length: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  chevron: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: 4 },
  modes: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 2 },
  mode: { flexDirection: "row", alignItems: "center", gap: 3 },
  legs: { gap: 6, paddingHorizontal: 14, paddingBottom: 12, paddingLeft: 62 },
  leg: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44 },
  legTitle: { fontSize: 15, fontWeight: "700" },
  toggle: { alignSelf: "center", minHeight: 44, borderRadius: 999, paddingHorizontal: 18, justifyContent: "center" },
  toggleText: { fontSize: 14, fontWeight: "700" }
});
