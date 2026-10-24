import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
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
import type { ReviewAnswerQuestion } from "../../lib/reviewAnswer";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { ROW_BLOCK, rowBlockHeight } from "../../lib/todayBlockRows";
import { formatLocaleDate } from "../../lib/localeDateFormat";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "../../lib/motion";

/**
 * Calendar › List on the iPhone (location v4 step 9, mock-up #ios-list, placement A): the day's blocks
 * in time order, with location only where it adds something — a place you weren't in a block at for
 * ten minutes (one row), the journey in progress, and a trip block's route and legs (opening into leg
 * rows). "Show Home and every place" adds Home and logged places as faint rows. Rows come from the shared
 * rules the web List uses.
 *
 * Step 14 part 3b: a "?" is answered where it sits. Tapping its row (or a place's "?") opens its question
 * under the row, with the deck's one-tap answers; "N to check" opens the next one and scrolls to it. The
 * answer itself (held for Undo, then saved) belongs to the caller (useCalendarCheckAnswers).
 *
 * Motion: a trip's legs, a question and the faint rows enter and leave with the app's local presence
 * (fade), and the rows below move with its layout transition (220 ms); an answered "?" leaves the same
 * way and Undo brings it back the same way; with Reduce Motion they appear and go at once.
 */

type ListItem =
  | { kind: "block"; key: string; atMs: number; entry: NativeCalendarPresentationEntry }
  | { kind: "location"; key: string; atMs: number; row: LocationListRow };

export function CalendarListView({
  checkQuestions,
  checks = [],
  checkTitles,
  clockFormat,
  dayEndMs,
  dayStartMs,
  entries,
  loggedLabel,
  nowMs,
  onAnswerCheck,
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
  /**
   * Opens a suggestion on its own screen: "More…" (pick or name another place), or the whole answer when
   * the List has no `onAnswerCheck`.
   */
  onOpenCheck?: (reviewItemId: string) => void;
  /** Answers a "?" in place: "Log it" (true) or "Skip" (false), with the deck's effects and Undo. */
  onAnswerCheck?: (reviewItemId: string, logged: boolean) => void;
  /** Each suggestion's question and answers (reviewAnswerQuestion). */
  checkQuestions?: ReadonlyMap<string, ReviewAnswerQuestion>;
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
  // The one question open under its row, if any.
  const [openCheckId, setOpenCheckId] = useState<string | null>(null);
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
  const checkRows = items.flatMap((item) => {
    const id = item.kind === "location" ? checkIdOf(item.row) : undefined;
    return id ? [{ key: item.key, id }] : [];
  });
  const checkKeys = checkRows.map((row) => row.key);
  const firstCheckId = checkRows[0]?.id;
  // A question whose "?" has left (answered, decided elsewhere, another day) closes, and stays closed: coming
  // back to the day or the row coming back does not reopen it (Codex r2 on #582).
  const shownOpenCheckId = openCheckId && checkRows.some((row) => row.id === openCheckId) ? openCheckId : null;
  if (openCheckId && !shownOpenCheckId) setOpenCheckId(null);
  // Today's chip opens the List at its first "?" (one scroll owner: this ScrollView; at once with Reduce Motion).
  // A request stays pending until its "?" has laid out, then is used once (Codex r1 on #573): a List
  // mounting fresh from Grid, a day change or places arriving later all still land on it. "N to check"
  // asks for the next "?" the same way (step 14 part 3b).
  const scroller = useRef<ScrollView>(null);
  // Each row's view, measured against the scroll content when the jump happens, so the position is the
  // row's current one, never a remembered one (Codex r3 on #573).
  const rowViews = useRef(new Map<string, View>());
  const content = useRef<View>(null);
  // "first" (Today's request) or the key of the row to show.
  const pendingScroll = useRef<string | null>(null);
  const firstCheckKey = checkKeys[0];
  const tryScroll = () => {
    const pending = pendingScroll.current;
    const target = pending === "first" ? firstCheckKey : pending;
    if (!pending || !target) return;
    // After the frame commits, so a row that just moved is measured where it is now.
    requestAnimationFrame(() => {
      const row = rowViews.current.get(target);
      if (pendingScroll.current !== pending || !row || !content.current) return;
      row.measureLayout(content.current, (_x, y) => {
        if (pendingScroll.current !== pending) return;
        pendingScroll.current = null;
        scroller.current?.scrollTo({ y: Math.max(0, y - 24), animated: !reduceMotion });
        if (pending === "first") onScrolledToFirstCheck?.();
      }, () => undefined);
    });
  };
  useEffect(() => {
    if (scrollToFirstCheck) pendingScroll.current = "first";
  }, [scrollToFirstCheck]);
  // A question belongs to the day it was opened on: another day closes it, even for a "?" both days show
  // (overnight sleep), before any request for the new day opens one (Codex r4 on #582).
  const [openDayStartMs, setOpenDayStartMs] = useState(dayStartMs);
  if (openDayStartMs !== dayStartMs) {
    setOpenDayStartMs(dayStartMs);
    setOpenCheckId(null);
  }
  // Today's chip also opens the first question, once its "?" is here, and VoiceOver hears it as when a "?"
  // is tapped (Codex r2 on #582).
  const [openFirstRequest, setOpenFirstRequest] = useState<{ request: number; id: string | null }>({ request: 0, id: null });
  if (scrollToFirstCheck && scrollToFirstCheck !== openFirstRequest.request && firstCheckId && onAnswerCheck) {
    setOpenFirstRequest({ request: scrollToFirstCheck, id: firstCheckId });
    setOpenCheckId(firstCheckId);
  }
  const openedFirstQuestion = openFirstRequest.id ? checkQuestions?.get(openFirstRequest.id)?.question : undefined;
  useEffect(() => {
    if (openedFirstQuestion) AccessibilityInfo.announceForAccessibility(openedFirstQuestion);
    // Once per request: the question's words are read when the chip opened it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFirstRequest.request]);
  // A "?" opens (or closes) its question; with no answers here it opens the suggestion instead.
  const toggleCheck = (id: string) => {
    if (!onAnswerCheck) {
      onOpenCheck?.(id);
      return;
    }
    const opening = shownOpenCheckId !== id;
    setOpenCheckId(opening ? id : null);
    const question = checkQuestions?.get(id);
    if (opening && question) AccessibilityInfo.announceForAccessibility(question.question);
  };
  // "N to check": the next "?" after the open one (or the first), opened and scrolled to.
  const openNextCheck = () => {
    if (!onAnswerCheck) {
      if (firstCheckId) onOpenCheck?.(firstCheckId);
      return;
    }
    const index = checkRows.findIndex((row) => row.id === shownOpenCheckId);
    const next = checkRows[(index + 1) % checkRows.length];
    if (!next) return;
    setOpenCheckId(next.id);
    // A Today request still waiting to land is done: this tap moves on from it (Codex r12 on #582).
    if (pendingScroll.current === "first") onScrolledToFirstCheck?.();
    pendingScroll.current = next.key;
    tryScroll();
    const question = checkQuestions?.get(next.id);
    if (question) AccessibilityInfo.announceForAccessibility(question.question);
  };
  const answerCheck = (id: string, logged: boolean) => {
    setOpenCheckId(null);
    onAnswerCheck?.(id, logged);
  };
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
      {/* The content's own view: rows are measured against it (a native ref, as Fabric needs; Codex r4 on #573). */}
      <View collapsable={false} ref={content} style={styles.contentInner}>
      <View style={styles.dayLine}>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.dayTitle, { color: theme.textPrimary }]}>
          {formatLocaleDate(new Date(dayStartMs), { weekday: "short", day: "numeric", month: "short" })}
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.dayMeta, { color: theme.textSecondary }]}>{loggedLabel} logged</Text>
        {checkKeys.length && firstCheckId && (onAnswerCheck || onOpenCheck) ? (
          <Pressable accessibilityHint={onAnswerCheck ? "Opens the next one" : "Opens the first one"} accessibilityRole="button" hitSlop={6} onPress={openNextCheck}
            style={({ pressed }) => [styles.checksChip, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}>
            <DayframeIcon color={theme.warningText} glyph={DAYFRAME_APP_ICONS.placeUnknown} size={14} />
            <Text {...mobileTextProps("control")} style={[styles.checksChipText, { color: theme.warningText }]}>{checkKeys.length} to check</Text>
          </Pressable>
        ) : null}
      </View>
      <Animated.View layout={localLayoutTransition(reduceMotion)} onLayout={() => tryScroll()}
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
                <BlockRow entry={item.entry} legsOpen={open} nowMs={nowMs} onOpen={() => onOpenEntry(item.entry)}
                  onToggleLegs={trip ? () => toggleLegs(item.entry.entryId) : undefined} route={trip?.route} legs={trip?.legs} theme={theme} time={time} />
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
              layout={localLayoutTransition(reduceMotion)} onLayout={() => tryScroll()}
              ref={(view: View | null) => { if (view) rowViews.current.set(item.key, view); else rowViews.current.delete(item.key); }}
              style={divider}>
              <LocationRow answering={Boolean(onAnswerCheck)} checkTitles={checkTitles} onToggleCheck={onAnswerCheck || onOpenCheck ? toggleCheck : undefined}
                openCheckId={shownOpenCheckId} row={item.row} theme={theme} time={time} />
              {(() => {
                const id = checkIdOf(item.row);
                const question = id && id === shownOpenCheckId ? checkQuestions?.get(id) : undefined;
                return id && question ? (
                  <Animated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}>
                    <CheckQuestion onAnswer={(logged) => answerCheck(id, logged)} onMore={question.more && onOpenCheck ? () => onOpenCheck(id) : undefined}
                      onOpen={question.opens && onOpenCheck ? () => onOpenCheck(id) : undefined} question={question} theme={theme} />
                  </Animated.View>
                ) : null;
              })()}
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
      </View>
    </ScrollView>
  );
}

/** A second line's glyph (Calendar v3): the registry's pin, route, Health and tag. */
const DETAIL_GLYPHS: Record<string, DayframeGlyph> = {
  place: DAYFRAME_APP_ICONS.places,
  trip: DAYFRAME_APP_ICONS.openTrip,
  health: DAYFRAME_APP_ICONS.sourceHealth,
  tag: DAYFRAME_APP_ICONS.tag
};

/**
 * A block's row (Calendar v3, owner choice A, 24 Oct 2026): Apple's List layout with Today's block-shaped
 * activity mark (34 wide, its height following the length as on Today's rows, the activity's icon; a
 * suggestion's mark is the "?"), the bold title, a second line with its pin / route / Health / tag icon
 * when it has one, and the start over the end on the right. Never Apple's thin colour bar (#341).
 */
function BlockRow({ entry, legs, legsOpen, nowMs, onOpen, onToggleLegs, route, theme, time }: {
  entry: NativeCalendarPresentationEntry; legs?: readonly TripLeg[]; legsOpen: boolean; nowMs: number; onOpen: () => void;
  onToggleLegs?: () => void; route?: string; theme: MobileTheme; time: (ms: number) => string;
}) {
  const end = entry.stoppedAtMs ?? nowMs;
  const markHeight = rowBlockHeight(Math.max(0, (end - entry.startedAtMs) / 1000));
  const detail = (entry.detailLines ?? []).find((line) => line.glyph !== "time" && line.text);
  return (
    <View style={styles.row}>
      <Pressable accessibilityHint="Opens the block" accessibilityLabel={[entry.accessibilityLabel, legs?.length ? modesLabel(legs, route) : null].filter(Boolean).join(". ")}
        accessibilityRole="button" onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, styles.blockRow, { opacity: pressed ? 0.7 : 1 }]}>
        {entry.isReview ? (
          <View style={[styles.blockMark, { height: markHeight, backgroundColor: theme.surfaceMuted }]}>
            <Text style={[styles.reviewMark, { color: theme.warningText }]}>?</Text>
          </View>
        ) : (
          <View style={[styles.blockMark, { height: markHeight, backgroundColor: entry.color }]}>
            <DayframeIcon color={entry.textColor} glyph={entry.glyph as DayframeGlyph} size={16} />
          </View>
        )}
        <View style={styles.text}>
          <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={[styles.title, { color: theme.textPrimary }]}>{entry.title}</Text>
          {detail ? (
            <View style={styles.detail}>
              <DayframeIcon color={theme.textSecondary} glyph={DETAIL_GLYPHS[detail.glyph] ?? DAYFRAME_APP_ICONS.places} size={12} />
              <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.meta, styles.detailText, { color: theme.textSecondary }]}>{detail.text}</Text>
            </View>
          ) : null}
          {legs?.length ? <ModesLine legs={legs} route={route} theme={theme} /> : null}
        </View>
        <View style={styles.times}>
          <Text {...mobileTextProps("numeric")} style={[styles.time, { color: theme.textPrimary }]}>{time(entry.startedAtMs)}</Text>
          <Text {...mobileTextProps("numeric")} style={[styles.time, { color: theme.textSecondary }]}>{entry.stoppedAtMs == null ? "now" : time(entry.stoppedAtMs)}</Text>
        </View>
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

function LocationRow({ answering, checkTitles, onToggleCheck, openCheckId, row, theme, time }: {
  /** The "?" opens its question here (step 14 part 3b); otherwise it opens the suggestion. */
  answering: boolean; checkTitles?: ReadonlyMap<string, string>; onToggleCheck?: (reviewItemId: string) => void;
  openCheckId: string | null; row: LocationListRow; theme: MobileTheme; time: (ms: number) => string;
}) {
  const hint = (id: string) => answering ? (openCheckId === id ? "Hides the question" : "Shows the question") : "Opens it to answer";
  if (row.kind === "check") {
    // A suggestion on a row of its own: Apple Health, a trip not in a block yet, or any other.
    const title = checkTitles?.get(row.checkId) ?? "Something to check";
    const span = row.startedAt ? `${time(Date.parse(row.startedAt))}${row.stoppedAt ? `–${time(Date.parse(row.stoppedAt))}` : ""}` : "";
    return (
      <Pressable accessibilityHint={hint(row.checkId)} accessibilityLabel={[`Check ${title}`, span, row.trip ? modesLabel(row.trip.legs, row.trip.route) : null].filter(Boolean).join(". ")}
        accessibilityRole="button" accessibilityState={answering ? { expanded: openCheckId === row.checkId } : undefined}
        disabled={!onToggleCheck} onPress={() => onToggleCheck?.(row.checkId)}
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
      {checkId && onToggleCheck ? (
        // Its "?": the place's suggestion, answered from here (location v4 step 14).
        <Pressable accessibilityHint={hint(checkId)} accessibilityLabel={`Check ${checkTitle}`} accessibilityRole="button"
          accessibilityState={answering ? { expanded: openCheckId === checkId } : undefined} hitSlop={4}
          onPress={() => onToggleCheck(checkId)} style={({ pressed }) => [styles.checkButton, { opacity: pressed ? 0.7 : 1 }]}>
          <CheckMark small theme={theme} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A "?"'s question under its row (mock-up #ios-list): what it asks, why, and one-tap answers in 44-point
 * pills ("Log it" first, then the skip, then "More…" for picking another place on its own screen). A
 * suggestion without a complete time cannot be answered here: it says so and offers "Open it" instead.
 */
function CheckQuestion({ onAnswer, onMore, onOpen, question, theme }: {
  onAnswer: (logged: boolean) => void; onMore?: () => void; onOpen?: () => void; question: ReviewAnswerQuestion; theme: MobileTheme;
}) {
  return (
    <View style={[styles.question, { backgroundColor: theme.surfaceMuted }]} testID="calendar-list-question">
      <Text {...mobileTextProps("itemTitle")} accessibilityRole="header" style={[styles.questionTitle, { color: theme.textPrimary }]}>{question.question}</Text>
      {question.detail ? <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{question.detail}</Text> : null}
      <View style={styles.answers}>
        {question.logLabel ? (
          <Pressable accessibilityRole="button" onPress={() => onAnswer(true)} testID="calendar-list-answer-log"
            style={({ pressed }) => [styles.answer, { backgroundColor: theme.textPrimary, opacity: pressed ? 0.8 : 1 }]}>
            <Text {...mobileTextProps("control")} style={[styles.answerText, { color: theme.surface }]}>{question.logLabel}</Text>
          </Pressable>
        ) : null}
        {question.skipLabel ? (
          <Pressable accessibilityRole="button" onPress={() => onAnswer(false)} testID="calendar-list-answer-skip"
            style={({ pressed }) => [styles.answer, { backgroundColor: theme.surface, opacity: pressed ? 0.8 : 1 }]}>
            <Text {...mobileTextProps("control")} style={[styles.answerText, { color: theme.textPrimary }]}>{question.skipLabel}</Text>
          </Pressable>
        ) : null}
        {question.opens && onOpen ? (
          <Pressable accessibilityHint="Opens the suggestion on its own screen" accessibilityRole="button" onPress={onOpen} testID="calendar-list-answer-open"
            style={({ pressed }) => [styles.answer, { backgroundColor: theme.surface, opacity: pressed ? 0.8 : 1 }]}>
            <Text {...mobileTextProps("control")} style={[styles.answerText, { color: theme.textPrimary }]}>Open it</Text>
          </Pressable>
        ) : null}
        {onMore ? (
          <Pressable accessibilityHint="Pick or name another place" accessibilityRole="button" onPress={onMore} testID="calendar-list-answer-more"
            style={({ pressed }) => [styles.answer, { backgroundColor: "transparent", opacity: pressed ? 0.7 : 1 }]}>
            <Text {...mobileTextProps("control")} style={[styles.answerText, { color: theme.textSecondary }]}>More…</Text>
          </Pressable>
        ) : null}
      </View>
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
  content: { paddingHorizontal: 16, paddingBottom: 140 },
  contentInner: { gap: 12 },
  dayLine: { flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 4, paddingTop: 4 },
  dayTitle: { fontSize: 20, fontWeight: "800" },
  dayMeta: { fontSize: 13, fontWeight: "600" },
  card: { borderRadius: DAYFRAME_BLOCKS.radius.phoneCard, overflow: "hidden" },
  empty: { padding: 20, fontSize: 15 },
  row: { flexDirection: "row", alignItems: "center" },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  faint: { opacity: 0.85, minHeight: 48, paddingVertical: 8 },
  mark: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  // Calendar v3 rows (owner choice A): Today's block mark, top-aligned beside the text.
  blockRow: { alignItems: "flex-start" },
  blockMark: { width: ROW_BLOCK.width, borderRadius: DAYFRAME_BLOCKS.radius.chip, alignItems: "center", justifyContent: "center" },
  reviewMark: { fontSize: 16, fontWeight: "800" },
  detail: { flexDirection: "row", alignItems: "center", gap: 4 },
  detailText: { flexShrink: 1 },
  times: { alignItems: "flex-end", gap: 2 },
  time: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
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
  checkMarkSmall: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  question: { marginHorizontal: 14, marginBottom: 12, marginLeft: 62, borderRadius: 14, padding: 12, gap: 4 },
  questionTitle: { fontSize: 15, fontWeight: "700" },
  answers: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  answer: { minHeight: 44, borderRadius: DAYFRAME_BLOCKS.radius.pill, paddingHorizontal: 16, justifyContent: "center" },
  answerText: { fontSize: 14, fontWeight: "700" }
});
