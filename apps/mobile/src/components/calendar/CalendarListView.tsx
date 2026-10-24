import { useEffect, useMemo, useRef, useState } from "react";
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
  type ListCheck,
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
  checks = [],
  checkTitles,
  clockFormat,
  dayEndMs,
  dayStartMs,
  entries,
  loggedLabel,
  nowMs,
  onOpenCheck,
  onOpenEntry,
  onScrolledToFirstCheck,
  scrollToFirstCheck,
  onRefresh,
  reduceMotion,
  refreshing,
  theme,
  timeline
}: {
  /** Open suggestions ("?"), each on the row it is about (location v4 step 14, iPhone part 3a). */
  checks?: readonly ListCheck[];
  /** Each suggestion's title, for its own row. */
  checkTitles?: ReadonlyMap<string, string>;
  clockFormat: ClockFormat;
  dayEndMs: number;
  /** The shown day's start: the line reads its date ("Thu 22 Oct"), as the mock-up's day line does. */
  dayStartMs: number;
  entries: readonly NativeCalendarPresentationEntry[];
  /** The day's logged time ("7h 3m"). */
  loggedLabel: string;
  nowMs: number;
  /** Opens a suggestion to answer it (Review, focused on it, until the List answers in place). */
  onOpenCheck?: (reviewItemId: string) => void;
  onOpenEntry: (entry: NativeCalendarPresentationEntry) => void;
  /** Changes when Today's "N to check today" opens the List: it scrolls to the first "?". */
  scrollToFirstCheck?: number;
  /** The request was used, so a List shown again later does not jump. */
  onScrolledToFirstCheck?: () => void;
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
    // Without the day's places (not read yet, or the read failed), its checks still show on rows of their own.
    const day = timeline ?? (checks.length ? emptyTimeline(dayStartMs, dayEndMs) : null);
    const rows = locationListRows(day, intervals, { nowMs, showAll, checks });
    // Oldest first, as the mock-up's day reads.
    return [
      ...blocks.map((entry): ListItem => ({ kind: "block", key: `block-${entry.entryId}`, atMs: entry.startedAtMs, entry })),
      ...rows.map((row): ListItem => ({ kind: "location", key: row.key, atMs: row.atMs, row }))
    ].sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
  }, [blocks, checks, dayEndMs, dayStartMs, nowMs, showAll, timeline]);
  // The day's "?", in time order: a place row's first suggestion, or a suggestion's own row.
  const checkIdOf = (row: LocationListRow) => row.kind === "check" ? row.checkId : row.kind === "place" ? row.checkIds[0] : undefined;
  const checkKeys = items.flatMap((item) => item.kind === "location" && checkIdOf(item.row) ? [item.key] : []);
  const firstCheckId = items.flatMap((item) => item.kind === "location" ? [checkIdOf(item.row)].filter(Boolean) as string[] : [])[0];
  // Today's chip opens the List at its first "?" (one scroll owner: this ScrollView; at once with Reduce Motion).
  // A request stays pending until this day's first "?" has laid out, then is used once (Codex r1 on #573):
  // a List mounting fresh from Grid, a day change or places arriving later all still land on it.
  const scroller = useRef<ScrollView>(null);
  const cardY = useRef<number | null>(null);
  const rowY = useRef(new Map<string, number>());
  const pendingScroll = useRef(false);
  const firstCheckKey = checkKeys[0];
  const tryScroll = () => {
    if (!pendingScroll.current || !firstCheckKey || cardY.current === null) return;
    const y = rowY.current.get(firstCheckKey);
    if (y === undefined) return;
    pendingScroll.current = false;
    scroller.current?.scrollTo({ y: Math.max(0, cardY.current + y - 24), animated: !reduceMotion });
    onScrolledToFirstCheck?.();
  };
  // Another day's rows are not this day's.
  useEffect(() => {
    rowY.current = new Map();
  }, [dayStartMs]);
  useEffect(() => {
    if (scrollToFirstCheck) pendingScroll.current = true;
  }, [scrollToFirstCheck]);
  useEffect(() => {
    tryScroll();
  });
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
      ref={scroller}
      refreshControl={<RefreshControl colors={[theme.accent]} onRefresh={onRefresh} refreshing={refreshing} tintColor={theme.accent} />}
      style={{ backgroundColor: theme.background }}
      testID="calendar-list"
    >
      <View style={styles.dayLine}>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.dayTitle, { color: theme.textPrimary }]}>
          {formatLocaleDate(new Date(dayStartMs), { weekday: "short", day: "numeric", month: "short" })}
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.dayMeta, { color: theme.textSecondary }]}>{loggedLabel} logged</Text>
        {checkKeys.length && firstCheckId && onOpenCheck ? (
          <Pressable accessibilityHint="Opens the first one" accessibilityRole="button" hitSlop={6} onPress={() => onOpenCheck(firstCheckId)}
            style={({ pressed }) => [styles.checksChip, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}>
            <DayframeIcon color={theme.warningText} glyph={DAYFRAME_APP_ICONS.placeUnknown} size={14} />
            <Text {...mobileTextProps("control")} style={[styles.checksChipText, { color: theme.warningText }]}>{checkKeys.length} to check</Text>
          </Pressable>
        ) : null}
      </View>
      <Animated.View layout={localLayoutTransition(reduceMotion)} onLayout={(event) => { cardY.current = event.nativeEvent.layout.y; tryScroll(); }}
        style={[styles.card, { backgroundColor: theme.surface }]}>
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
              layout={localLayoutTransition(reduceMotion)} onLayout={(event) => { rowY.current.set(item.key, event.nativeEvent.layout.y); tryScroll(); }}
              style={divider}>
              <LocationRow checkTitles={checkTitles} onOpenCheck={onOpenCheck} row={item.row} theme={theme} time={time} />
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
      <Pressable accessibilityHint="Opens the block" accessibilityLabel={[entry.accessibilityLabel, legs?.length ? modesLabel(legs, route) : null].filter(Boolean).join(". ")}
        accessibilityRole="button" onPress={onOpen}
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

/** What VoiceOver reads for a trip's route and modes, inside its row's own label (Codex r1 on #570). */
function modesLabel(legs: readonly TripLeg[], route?: string) {
  return `${route ? `${route}. ` : ""}Legs: ${legs.map((leg) => legModeLabel(leg)).join(", ")}`;
}

/** A trip's route and modes on one line; an unsure leg's name in amber with its "?". Read as part of its row. */
function ModesLine({ legs, route, theme }: { legs: readonly TripLeg[]; route?: string; theme: MobileTheme }) {
  return (
    <View importantForAccessibility="no-hide-descendants" style={styles.modes}>
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

function LocationRow({ checkTitles, onOpenCheck, row, theme, time }: {
  checkTitles?: ReadonlyMap<string, string>; onOpenCheck?: (reviewItemId: string) => void; row: LocationListRow; theme: MobileTheme;
  time: (ms: number) => string;
}) {
  if (row.kind === "check") {
    // A suggestion on a row of its own: Apple Health, a trip not in a block yet, or any other.
    const title = checkTitles?.get(row.checkId) ?? "Something to check";
    const span = row.startedAt ? `${time(Date.parse(row.startedAt))}${row.stoppedAt ? `–${time(Date.parse(row.stoppedAt))}` : ""}` : "";
    return (
      <Pressable accessibilityHint="Opens it to answer" accessibilityLabel={[`Check ${title}`, span, row.trip ? modesLabel(row.trip.legs, row.trip.route) : null].filter(Boolean).join(". ")}
        accessibilityRole="button" disabled={!onOpenCheck} onPress={() => onOpenCheck?.(row.checkId)}
        style={({ pressed }) => [styles.rowMain, { opacity: pressed ? 0.7 : 1 }]}>
        <CheckMark theme={theme} />
        <View style={styles.text}>
          <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
          {span ? <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{span}</Text> : null}
          {row.trip?.legs.length ? <ModesLine legs={row.trip.legs} route={row.trip.route} theme={theme} /> : null}
        </View>
      </Pressable>
    );
  }
  if (row.kind === "open_trip") {
    return (
      <View accessible accessibilityLabel={[`Travelling from ${row.fromName ?? "Unknown place"} since ${time(Date.parse(row.startedAt))}`,
        row.legs.length ? modesLabel(row.legs) : null, "Logs when you arrive."].filter(Boolean).join(". ")} style={styles.rowMain}>
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
  const notInBlock = row.unloggedSeconds >= 60 ? `${formatDuration(row.unloggedSeconds)} not in a block` : null;
  const checkId = row.checkIds[0];
  const checkTitle = checkId ? checkTitles?.get(checkId) ?? label : null;
  return (
    <View style={styles.row}>
      <View accessible accessibilityLabel={[label, notInBlock, span].filter(Boolean).join(", ")} style={styles.rowMain}>
        <View style={[styles.mark, styles.unknownMark, { backgroundColor: theme.surfaceMuted, borderColor: theme.warning }]}>
          <DayframeIcon color={theme.warningText} glyph={DAYFRAME_APP_ICONS.placeUnknown} size={18} />
        </View>
        <View style={styles.text}>
          <Text {...mobileTextProps("itemTitle")} style={[styles.title, { color: theme.textPrimary }]}>{label}</Text>
          {notInBlock ? <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{notInBlock}</Text> : null}
          <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{span}</Text>
        </View>
        <Text {...mobileTextProps("numeric")} style={[styles.length, { color: theme.textSecondary }]}>{formatDuration(length)}</Text>
      </View>
      {checkId && onOpenCheck ? (
        // Its "?": the place's suggestion, answered from here (location v4 step 14).
        <Pressable accessibilityHint="Opens it to answer" accessibilityLabel={`Check ${checkTitle}`} accessibilityRole="button" hitSlop={4}
          onPress={() => onOpenCheck(checkId)} style={({ pressed }) => [styles.checkButton, { opacity: pressed ? 0.7 : 1 }]}>
          <CheckMark small theme={theme} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The hatched "?" mark of something to check. */
function CheckMark({ small = false, theme }: { small?: boolean; theme: MobileTheme }) {
  return (
    <View style={[small ? styles.checkMarkSmall : styles.mark, styles.unknownMark, { backgroundColor: theme.surfaceMuted, borderColor: theme.warning }]}>
      <DayframeIcon color={theme.warningText} glyph={DAYFRAME_APP_ICONS.placeUnknown} size={small ? 16 : 18} />
    </View>
  );
}

/** A day with no places: its checks still sit at their times. */
function emptyTimeline(dayStartMs: number, dayEndMs: number): LocationTimeline {
  return { date: "", timeZone: "", dayStart: new Date(dayStartMs).toISOString(), dayEnd: new Date(dayEndMs).toISOString(), gaps: [], openTrip: null, items: [] };
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
  toggleText: { fontSize: 14, fontWeight: "700" },
  checksChip: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, borderRadius: DAYFRAME_BLOCKS.radius.pill, paddingHorizontal: 12 },
  checksChipText: { fontSize: 13, fontWeight: "700" },
  checkButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: 6 },
  checkMarkSmall: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" }
});
