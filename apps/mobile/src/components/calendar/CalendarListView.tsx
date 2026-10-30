import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { runOnJS } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { playDaySwipeTick } from "../../lib/daySwipeHaptic";
import { SHOW_ALL_PLACES_STORAGE_KEY } from "../../lib/calendarPreferences";
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
  type TimelinePlace,
  type TimelineTrip,
  type TripLeg
} from "@dayframe/shared";
import { DayframeIcon } from "../icons/DayframeIcon";
import { DIVIDER_INSET_PAST_BLOCK, InsetDivider } from "../InsetDivider";
import { COMPACT_PILL_HIT_SLOP, compactPillStyles } from "../compactPill";
import type { NativeCalendarPresentationEntry } from "../../lib/nativeCalendarPresentation";
import type { ReviewAnswerQuestion } from "../../lib/reviewAnswer";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { ROW_BLOCK, rowBlockHeight } from "../../lib/todayBlockRows";
import { formatLocaleDate } from "../../lib/localeDateFormat";
import { localLayoutTransition, localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import { nowRowKey } from "../../lib/calendarTodayPress";

/**
 * Calendar › List on the iPhone (location v4 step 9, mock-up #ios-list, placement A): the day's blocks
 * in time order, with location only where it adds something — a place you weren't in a block at for
 * ten minutes (one row; a place your blocks cover is never one), the journey in progress, and a trip block's
 * route and modes (stacked, the modes opening into leg rows). "All places" (remembered on this device) adds
 * Home and logged places as quiet rows. Rows come from the shared rules the web List uses.
 *
 * Owner, 28 Oct 2026: every location row has one tile with one amber dot when it asks, and tapping it opens
 * its sheet (a place's, or a trip's) with its "?" asked at the top; a confident guess answers in one tap with
 * the row's compact Yes pill. A row that opens a sheet never also shows the question under it: opening a "?"
 * from anywhere (the chip's "N to check", the badge, Today's chip, the Grid) opens that sheet. Only Apple
 * Health's "?" (no sheet) opens its question under its row, with compact pills. "N to check" counts every "?"
 * from the last 7 days and steps through them oldest first, across days (the caller's onNextCheck). The
 * answer itself (gated on queued corrections, held for Undo, then saved) belongs to the caller (useCalendarCheckAnswers).
 *
 * Motion: a trip's legs, a question and the quiet rows enter and leave with the app's local presence
 * (fade), and the rows below move with its layout transition (220 ms); an answered "?" leaves the same
 * way and Undo brings it back the same way; with Reduce Motion they appear and go at once. Sheets own
 * their own presentation (BottomSheetShell).
 */

type ListItem =
  | { kind: "block"; key: string; atMs: number; entry: NativeCalendarPresentationEntry }
  | { kind: "location"; key: string; atMs: number; row: LocationListRow };

export function CalendarListView({
  blockChecks,
  checkGlyphs,
  checkKinds,
  checkQuestions,
  checks = [],
  checkTitles,
  checkTotal,
  onNextCheck,
  onSwipeDay,
  openCheckRequest = null,
  clearSelectionRequest = 0,
  timelineReadAt = null,
  onRequestFreshRead,
  clockFormat,
  dayEndMs,
  dayStartMs,
  entries,
  loggedLabel,
  nowMs,
  onAnswerCheck,
  onOpenCheck,
  onOpenCheckChange,
  onOpenEntry,
  onOpenPlace,
  onOpenTripLeg,
  onScrolledToFirstCheck,
  scrollToFirstCheck,
  scrollToNowRequest = 0,
  cancelWaitingTapRequest = 0,
  onRefresh,
  reduceMotion,
  refreshing,
  theme,
  timeline
}: {
  /** Open suggestions ("?"), each on the row it is about (location v4 step 14, iPhone part 3a). */
  checks?: readonly ListCheck[];
  /**
   * The "?" asked on a block (location v4 design §7, "a block ran into your trip"), by block id: never a row of its
   * own; the block's row has the dot (`entry.asking`) and opens the block's sheet with the question at its top.
   */
  blockChecks?: ReadonlyMap<string, string>;
  /**
   * What each "?" is about, from the suggestion itself (Codex r2 on #610): Apple Health's ("health") and one about
   * nothing the List can open ("none": a legacy location suggestion without a segment) ask under their row; a
   * place's or a trip's opens its sheet. Absent, a "?" with a segment is taken as a place's or trip's.
   */
  checkKinds?: ReadonlyMap<string, CalendarCheckKind>;
  /** Each "?" row's own icon (a trip's route, Apple Health's heart, a place's pin). */
  checkGlyphs?: ReadonlyMap<string, DayframeGlyph>;
  /** Every "?" that still asks, the last 7 days on any day (owner, 28 Oct 2026, concern 4); the chip shows this count. */
  checkTotal?: number;
  /** "N to check" opens the next one after the one last opened here, oldest first, across days. */
  onNextCheck?: (openCheckId: string | null) => void;
  /**
   * Owner Q3 (28 Oct 2026): a sideways swipe on the List moves a day, as on the Grid (left: the next day). Vertical
   * scrolling wins any gesture that starts vertical.
   */
  onSwipeDay?: (days: number) => void;
  /**
   * Open this "?" (by id) once its row is here, and scroll to it: a place's or a trip's in its sheet, Apple
   * Health's under its row. A new request each time.
   */
  openCheckRequest?: { id: string; request: number; at?: number } | null;
  /**
   * A new number closes the open question and drops any waiting request or scroll, the same day included (an old
   * link's item that no longer asks opens its day with nothing selected; Codex r3 on #615).
   */
  clearSelectionRequest?: number;
  /**
   * When the shown day's places were read (asked for). A request made after it (`at`) for a place's or trip's "?"
   * the read lacks waits for the next read of that day before asking under its row (Codex r3 on #610).
   */
  timelineReadAt?: number | null;
  /** Reads the shown day's places again: a tap on a "?" whose item they lack waits for that read (Codex r4 on #610). */
  onRequestFreshRead?: () => void;
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
   * The caller's own opener for a "?" (step 15: there is no Review screen): a place's when there is no
   * `onOpenPlace`, a trip's when there is no `onOpenTripLeg`, or the whole answer when the List has no `onAnswerCheck`.
   */
  onOpenCheck?: (reviewItemId: string) => void;
  /** Answers a "?" in place: "Log it" (true) or "Skip" (false), with the deck's effects and Undo. */
  onAnswerCheck?: (reviewItemId: string, logged: boolean) => void;
  /** Each suggestion's question and answers (reviewAnswerQuestion). */
  checkQuestions?: ReadonlyMap<string, ReviewAnswerQuestion>;
  onOpenEntry: (entry: NativeCalendarPresentationEntry) => void;
  /** Opens a place's correction sheet (step 12), its "?" asked at the top when it has one. */
  onOpenPlace?: (place: TimelinePlace, label: string) => void;
  /** Opens a trip's correction sheet at one of its legs (step 12): a leg's mode, on any trip. */
  onOpenTripLeg?: (trip: TimelineTrip & { route: string }, legIndex: number | null) => void;
  /** Which "?" has its question open under its row (card B part 2: only that one looks for a place nearby). */
  onOpenCheckChange?: (reviewItemId: string | null) => void;
  /** Changes when Today's "N to check today" opens the List: it scrolls to the first "?" and opens it. */
  scrollToFirstCheck?: number;
  /** The request was used, so a List shown again later does not jump. */
  onScrolledToFirstCheck?: (request: number) => void;
  /**
   * A new number cancels a tap on a "?" still waiting for its places, and nothing else: an open question stays open
   * (the header's Today pill on today).
   */
  cancelWaitingTapRequest?: number;
  /** A new number scrolls to the row for now (the header's Today pill on today). A List mounting later ignores it. */
  scrollToNowRequest?: number;
  onRefresh: () => void;
  reduceMotion: boolean;
  refreshing: boolean;
  theme: MobileTheme;
  timeline: LocationTimeline | null;
}) {
  const [showAll, setShowAllState] = useState(false);
  // Owner, 28 Oct 2026 (concern 3): "All places" is remembered on this device.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(SHOW_ALL_PLACES_STORAGE_KEY).then((value) => {
      if (live && value != null) setShowAllState(value === "1");
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const setShowAll = (update: (current: boolean) => boolean) => setShowAllState((current) => {
    const next = update(current);
    void AsyncStorage.setItem(SHOW_ALL_PLACES_STORAGE_KEY, next ? "1" : "0").catch(() => undefined);
    return next;
  });
  // The one question open under its row, if any (Apple Health's only).
  const [openCheckId, setOpenCheckId] = useState<string | null>(null);
  const [openLegs, setOpenLegs] = useState<ReadonlySet<string>>(() => new Set());
  // The day's blocks (Review suggestions stay on the Grid and Review for now).
  const blocks = useMemo(() => entries.filter((entry) => !entry.isReview), [entries]);
  // A "?" asked on its block (location v4 design §7) is never a row of its own: its dot is on the block's row.
  const blockCheckIds = useMemo(() => new Set(blockChecks ? [...blockChecks.values()] : []), [blockChecks]);
  const rowChecks = useMemo(() => checks.filter((check) => !blockCheckIds.has(check.id) && checkKinds?.get(check.id) !== "block"),
    [blockCheckIds, checkKinds, checks]);
  const trips = useMemo(() => tripsByBlockId(timeline), [timeline]);
  const items = useMemo<ListItem[]>(() => {
    const intervals = blocks.map((entry) => ({
      startedAt: new Date(entry.startedAtMs).toISOString(),
      stoppedAt: entry.stoppedAtMs == null ? null : new Date(entry.stoppedAtMs).toISOString()
    }));
    // Without the day's places (not read yet, or the read failed), its checks still show on rows of their own.
    const day = timeline ?? (rowChecks.length ? emptyTimeline(dayStartMs, dayEndMs) : null);
    // A place your blocks cover is never a row (owner, 28 Oct 2026, concern 2).
    const rows = locationListRows(day, intervals, { nowMs, showAll, checks: rowChecks, hideCovered: true });
    // Oldest first, as the mock-up's day reads.
    return [
      ...blocks.map((entry): ListItem => ({ kind: "block", key: `block-${entry.entryId}`, atMs: entry.startedAtMs, entry })),
      ...rows.map((row): ListItem => ({ kind: "location", key: row.key, atMs: row.atMs, row }))
    ].sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));
  }, [blocks, rowChecks, dayEndMs, dayStartMs, nowMs, showAll, timeline]);
  // The day's "?", in time order: a place row's first suggestion, or a suggestion's own row. A place's or a
  // trip's opens its sheet (`open`); only Apple Health's (no sheet) opens its question under its row (`inline`).
  // What each "?" is about comes from the caller (`checkKinds`, from the suggestion itself; Codex r2 on #610): Apple
  // Health's, and one about nothing the List can open (a legacy location suggestion without a segment), have no
  // sheet and ask under their row. A place's or a trip's is only known for what it is once the day's places are
  // read: until then its row is a placeholder (`known: false`), and a request or a tap for it waits (Codex r1 on
  // #610). Intended (owner's ruling, Codex r3 on #610): a "?" whose place or trip can't be resolved — a legacy one
  // without a segment ("none"), or one whose item the day's places lack once read — has no sheet, so it asks under
  // its row; with Review gone (step 15) that is its only way to be answered. A request made after the last read
  // waits for the next read of that day before falling back (`fallback`, `timelineReadAt`).
  const checkIdOf = (row: LocationListRow) => row.kind === "check" ? row.checkId : row.kind === "place" ? row.checkIds[0] : undefined;
  const segmentOf = new Map(checks.map((check) => [check.id, check.segmentId] as const));
  const kindOf = (id: string) => checkKinds?.get(id) ?? (segmentOf.get(id) ? "place" : "none");
  const askingIds = new Set(checks.map((check) => check.id));
  const checkRows = items.flatMap((item) => {
    if (item.kind === "block") {
      // A block's own "?": its row opens the block's sheet, the question at its top (location v4 design §7).
      const id = blockChecks?.get(item.entry.entryId);
      if (!id || !askingIds.has(id) || !item.entry.asking) return [];
      return [{ key: item.key, id, inline: false, known: true, fallback: false, open: () => onOpenEntry(item.entry) }];
    }
    const id = checkIdOf(item.row);
    if (!id) return [];
    const sheetless = kindOf(id) === "health" || kindOf(id) === "none";
    const known = sheetless || timeline != null;
    const inline = item.row.kind === "check" && !item.row.trip && known;
    // A place's or trip's asked under its row only because its item isn't in the places read.
    const fallback = inline && !sheetless;
    return [{ key: item.key, id, inline, known, fallback,
      open: inline || !known ? undefined : sheetOpener(item.row, id, { checkQuestions, onOpenCheck, onOpenPlace, onOpenTripLeg }) }];
  });
  const inlineIds = new Set(checkRows.filter((row) => row.inline).map((row) => row.id));
  // The "?" last opened here (in its sheet or under its row): "N to check" moves on from it.
  const lastOpenedCheckId = useRef<string | null>(null);
  const checkKeys = checkRows.map((row) => row.key);
  // A question whose "?" has left (answered, decided elsewhere, another day) closes, and stays closed: coming
  // back to the day or the row coming back does not reopen it (Codex r2 on #582).
  const shownOpenCheckId = openCheckId && checkRows.some((row) => row.id === openCheckId) ? openCheckId : null;
  if (openCheckId && !shownOpenCheckId) setOpenCheckId(null);
  // Leaving the List (for Grid, or another day's screen) closes its question for whoever searches for it
  // (Codex r1 on #600).
  useEffect(() => {
    onOpenCheckChange?.(shownOpenCheckId);
  }, [onOpenCheckChange, shownOpenCheckId]);
  useEffect(() => () => onOpenCheckChange?.(null), [onOpenCheckChange]);
  // Today's chip opens the List at its first "?" (one scroll owner: this ScrollView; at once with Reduce Motion).
  // A request stays pending until its "?" has laid out, then is used once (Codex r1 on #573): a List
  // mounting fresh from Grid, a day change or places arriving later all still land on it. "N to check"
  // asks for the next "?" the same way (step 14 part 3b).
  const scroller = useRef<ScrollView>(null);
  // Each row's view, measured against the scroll content when the jump happens, so the position is the
  // row's current one, never a remembered one (Codex r3 on #573).
  const rowViews = useRef(new Map<string, View>());
  const content = useRef<View>(null);
  // One waiting scroll: "first" (Today's request) or the key of the row to show, and the day it was made on. Each
  // request is a new object, so a measurement still out for a replaced one can never act for its successor.
  // `request`: a "first" request's number, so its acknowledgement can only ever clear that request.
  const pendingScroll = useRef<{ target: string; dayStartMs: number; request?: number } | null>(null);
  const shownDayStartMs = useRef(dayStartMs);
  shownDayStartMs.current = dayStartMs;
  // A finger owns the List from the start of a drag until it lifts or the scroll settles: a request arriving then is
  // used up, not started (Codex r3 on #640).
  const dragging = useRef(false);
  const dropPendingScroll = () => {
    const dropped = pendingScroll.current;
    pendingScroll.current = null;
    // A "first" request is over, so a List shown again later has nothing to replay.
    if (dropped?.request) onScrolledToFirstCheck?.(dropped.request);
  };
  const firstCheckKey = checkKeys[0];
  const tryScroll = () => {
    const pending = pendingScroll.current;
    const target = pending?.target === "first" ? firstCheckKey : pending?.target;
    if (!pending || !target) return;
    // After the frame commits, so a row that just moved is measured where it is now.
    requestAnimationFrame(() => {
      const row = rowViews.current.get(target);
      if (pendingScroll.current !== pending || pending.dayStartMs !== shownDayStartMs.current || !row || !content.current) return;
      row.measureLayout(content.current, (_x, y) => {
        if (pendingScroll.current !== pending || pending.dayStartMs !== shownDayStartMs.current) return;
        pendingScroll.current = null;
        scroller.current?.scrollTo({ y: Math.max(0, y - 24), animated: !reduceMotion });
        if (pending.request) onScrolledToFirstCheck?.(pending.request);
      }, () => undefined);
    });
  };
  // Another day ends what was waiting on the last one. This runs first, so a request arriving with the day survives.
  useEffect(() => {
    if (pendingScroll.current && pendingScroll.current.dayStartMs !== dayStartMs) dropPendingScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStartMs]);
  useEffect(() => {
    if (!scrollToFirstCheck) return;
    pendingScroll.current = { target: "first", dayStartMs, request: scrollToFirstCheck };
    if (dragging.current) dropPendingScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToFirstCheck]);
  // The Today pill on today: the same one scroll owner and row measurement as a "?" (a drag stops it; a repeat
  // retargets; at once with Reduce Motion). A day with no rows has nothing to reach, so it goes to the top.
  const handledNowRequest = useRef(scrollToNowRequest);
  useEffect(() => {
    if (!scrollToNowRequest || scrollToNowRequest === handledNowRequest.current) return;
    handledNowRequest.current = scrollToNowRequest;
    if (dragging.current) return;
    const key = nowRowKey(items.filter((item) => rowViews.current.has(item.key)), nowMs);
    pendingScroll.current = key ? { target: key, dayStartMs } : null;
    if (key) tryScroll();
    else scroller.current?.scrollTo({ y: 0, animated: !reduceMotion });
    // Once per request, with the rows and time of the render it arrived in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToNowRequest]);
  // A question belongs to the day it was opened on: another day closes it, even for a "?" both days show
  // (overnight sleep), before any request for the new day opens one (Codex r4 on #582).
  const [openDayStartMs, setOpenDayStartMs] = useState(dayStartMs);
  if (openDayStartMs !== dayStartMs) {
    setOpenDayStartMs(dayStartMs);
    setOpenCheckId(null);
  }
  // Owner, 28 Oct 2026 (concern 4): a request for one "?" by id (the chip's next, the badge, the Grid's "?") opens
  // it once its row is here, after any day change has closed the previous question, and scrolls to it: a place's
  // or a trip's in its sheet (never also under its row), Apple Health's under its row.
  const [handledCheckRequest, setHandledCheckRequest] = useState(0);
  // A tap on a "?" not known yet waits the same way, as a request of the List's own (negative numbers).
  // It stands until the caller makes a new request after it.
  // `clear`: the clear generation it was made in; a later clear makes it stale.
  const [tapRequest, setTapRequest] = useState<{ id: string; request: number; after: number; at?: number; clear: number } | null>(null);
  const tapRequests = useRef(0);
  // A clear (Codex r3 and r4 on #615) takes effect in the render it arrives in: every tap request made before it, and
  // the caller's request it arrived with or any earlier one, are ignored from then on, whatever else changed in that
  // render (the day's places arriving, say), so nothing waiting can reopen a question or a sheet.
  const [clearedFor, setClearedFor] = useState(clearSelectionRequest);
  const [ignoredUpTo, setIgnoredUpTo] = useState<number | null>(null);
  const clearing = clearedFor !== clearSelectionRequest;
  const ignoreUpTo = clearing ? Math.max(ignoredUpTo ?? -Infinity, openCheckRequest?.request ?? -Infinity) : ignoredUpTo;
  if (clearing) {
    setClearedFor(clearSelectionRequest);
    setIgnoredUpTo(Number.isFinite(ignoreUpTo) ? ignoreUpTo : null);
    setOpenCheckId(null);
    setTapRequest(null);
    pendingScroll.current = null;
  }
  const [waitingTapsCancelledFor, setWaitingTapsCancelledFor] = useState(cancelWaitingTapRequest);
  const cancellingWaitingTap = waitingTapsCancelledFor !== cancelWaitingTapRequest;
  if (cancellingWaitingTap) {
    setWaitingTapsCancelledFor(cancelWaitingTapRequest);
    setTapRequest(null);
  }
  const liveTap = tapRequest && tapRequest.clear === clearSelectionRequest && !cancellingWaitingTap ? tapRequest : null;
  const liveCheckRequest = openCheckRequest && (ignoreUpTo == null || openCheckRequest.request > ignoreUpTo) ? openCheckRequest : null;
  const request = liveTap && liveTap.after === (openCheckRequest?.request ?? 0) ? liveTap : liveCheckRequest;
  const readSince = (row: { fallback: boolean }) => !row.fallback || !request || !("at" in request) || request.at == null
    || (timelineReadAt ?? 0) >= request.at;
  const requestedRow = request && request.request !== handledCheckRequest
    ? checkRows.find((row) => row.id === request.id && row.known && readSince(row)) : undefined;
  if (request && requestedRow) {
    setHandledCheckRequest(request.request);
    if (requestedRow.inline) setOpenCheckId(request.id);
  }
  useEffect(() => {
    if (!handledCheckRequest || !request || request.request !== handledCheckRequest) return;
    const row = checkRows.find((each) => each.id === request.id);
    if (!row) return;
    pendingScroll.current = { target: row.key, dayStartMs };
    tryScroll();
    openCheckRow(row, false);
    // Once per handled request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handledCheckRequest]);
  // Today's chip also opens the first "?", once it is here, and VoiceOver hears it as when a "?" is tapped
  // (Codex r2 on #582): a place's or a trip's in its sheet, Apple Health's under its row.
  const [openFirstRequest, setOpenFirstRequest] = useState<{ request: number; id: string | null }>({ request: 0, id: null });
  // Only once every "?" here is known, so the first is the real first and opens the right way (Codex r1 on #610).
  const firstCheckRow = checkRows.every((row) => row.known) ? checkRows[0] : undefined;
  if (!clearing && scrollToFirstCheck && scrollToFirstCheck !== openFirstRequest.request && firstCheckRow
    && (firstCheckRow.inline ? onAnswerCheck : firstCheckRow.open)) {
    setOpenFirstRequest({ request: scrollToFirstCheck, id: firstCheckRow.id });
    if (firstCheckRow.inline) setOpenCheckId(firstCheckRow.id);
  }
  useEffect(() => {
    const row = openFirstRequest.id ? checkRows.find((each) => each.id === openFirstRequest.id) : undefined;
    if (row) openCheckRow(row, false);
    // Once per request: the sheet opens, or the question's words are read, when the chip opened it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFirstRequest.request]);
  // Opens a "?": its sheet, or (Apple Health) its question under the row, already set open when `inline`.
  const openCheckRow = (row: (typeof checkRows)[number], toggle: boolean) => {
    lastOpenedCheckId.current = row.id;
    if (!row.inline) {
      row.open?.();
      return;
    }
    if (toggle) setOpenCheckId(row.id);
    const question = checkQuestions?.get(row.id);
    if (question) AccessibilityInfo.announceForAccessibility(question.question);
  };
  // A "?" row's tap: a trip's sheet; one not known yet waits for the day's places; one with no sheet opens (or
  // closes) its question under the row, or with no answers here, the suggestion on its own screen.
  const toggleCheck = (id: string) => {
    const row = checkRows.find((each) => each.id === id);
    if (!row) return;
    if (!row.known) {
      // Timestamped, with a fresh read asked for: a response already in flight from before the tap that lacks its
      // item never opens it under its row (Codex r5 on #610).
      tapRequests.current -= 1;
      setTapRequest({ id, request: tapRequests.current, after: openCheckRequest?.request ?? 0, at: Date.now(), clear: clearSelectionRequest });
      onRequestFreshRead?.();
      return;
    }
    if (shownOpenCheckId === id) {
      setOpenCheckId(null);
      return;
    }
    // A place's or trip's whose item the places read lack: it asks under its row only once they are read again after
    // this tap, as a request does (Codex r4 on #610).
    if (row.fallback) {
      const at = Date.now();
      if (timelineReadAt == null || timelineReadAt < at) {
        tapRequests.current -= 1;
        setTapRequest({ id, request: tapRequests.current, after: openCheckRequest?.request ?? 0, at, clear: clearSelectionRequest });
        onRequestFreshRead?.();
        return;
      }
    }
    if (!row.inline) {
      openCheckRow(row, false);
      return;
    }
    if (!onAnswerCheck) {
      onOpenCheck?.(id);
      return;
    }
    if (shownOpenCheckId === id) {
      setOpenCheckId(null);
      return;
    }
    openCheckRow(row, true);
  };
  const answerCheck = (id: string, logged: boolean) => {
    setOpenCheckId(null);
    onAnswerCheck?.(id, logged);
  };
  useEffect(() => {
    tryScroll();
  });
  const time = (ms: number) => formatClockTime(new Date(ms), clockFormat);
  // The swipe owns its haptic: the selected day changes because of this gesture, not by a tap or a link.
  const swipedDay = useCallback((days: number) => {
    playDaySwipeTick();
    onSwipeDay?.(days);
  }, [onSwipeDay]);
  const swipeDay = useMemo(() => Gesture.Pan()
    .enabled(Boolean(onSwipeDay))
    .activeOffsetX([-24, 24])
    .failOffsetY([-12, 12])
    .onEnd((event, success) => {
      "worklet";
      // A cancelled pan (`success` false) changes nothing, however far it went (Codex r1 on #641).
      if (success && onSwipeDay && (Math.abs(event.translationX) > 64 || Math.abs(event.velocityX) > 700)) runOnJS(swipedDay)(event.translationX < 0 ? 1 : -1);
    }), [onSwipeDay, swipedDay]);
  const toggleLegs = (id: string) => setOpenLegs((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      onMomentumScrollEnd={() => { dragging.current = false; }}
      onScrollBeginDrag={() => {
        dragging.current = true;
        dropPendingScroll();
      }}
      onScrollEndDrag={() => { dragging.current = false; }}
      ref={scroller}
      refreshControl={<RefreshControl colors={[theme.accent]} onRefresh={onRefresh} refreshing={refreshing} tintColor={theme.accent} />}
      style={{ backgroundColor: theme.background }}
      testID="calendar-list"
    >
      {/* The content's own view: rows are measured against it (a native ref, as Fabric needs; Codex r4 on #573). */}
      <GestureDetector gesture={swipeDay}>
      <View collapsable={false} ref={content} style={styles.contentInner}>
      <View style={styles.dayLine}>
        <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" style={[styles.dayTitle, { color: theme.textPrimary }]}>
          {formatLocaleDate(new Date(dayStartMs), { weekday: "short", day: "numeric", month: "short" })}
        </Text>
        <Text {...mobileTextProps("metadata")} style={[styles.dayMeta, { color: theme.textSecondary }]}>{loggedLabel} logged</Text>
        {onNextCheck && checkTotal ? (
          // Owner, 28 Oct 2026 (concern 4): every "?" from the last 7 days, oldest first, across days.
          <Pressable accessibilityHint="Opens the next one, oldest first" accessibilityLabel={`${checkTotal} to check in the last 7 days`}
            accessibilityRole="button" hitSlop={6} onPress={() => {
              // A Today request still waiting to land is done: this tap moves on from it (Codex r12 on #582).
              if (pendingScroll.current?.request) onScrolledToFirstCheck?.(pendingScroll.current.request);
              onNextCheck(shownOpenCheckId ?? lastOpenedCheckId.current);
            }}
            style={({ pressed }) => [styles.checksChip, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.8 : 1 }]} testID="calendar-list-checks-chip">
            <View style={[styles.chipDot, { backgroundColor: theme.warning }]} />
            <Text {...mobileTextProps("control")} style={[styles.checksChipText, { color: theme.textPrimary }]}>{checkTotal} to check</Text>
          </Pressable>
        ) : null}
      </View>
      {hasLocationPlaces(timeline) ? (
        // Owner item H (28 Oct 2026): a quiet filter by the day's header, not a filled pill under the List.
        <Pressable accessibilityHint="Shows or hides places you didn't need to check" accessibilityRole="button" accessibilityState={{ selected: showAll }}
          hitSlop={8} onPress={() => setShowAll((current) => !current)} style={styles.filter} testID="calendar-list-show-all">
          <DayframeIcon color={theme.textSecondary} glyph={DAYFRAME_APP_ICONS.places} size={13} />
          <Text {...mobileTextProps("control")} style={[styles.filterText, { color: theme.textSecondary }]}>{showAll ? "Fewer places" : "All places"}</Text>
        </Pressable>
      ) : null}
      <Animated.View layout={localLayoutTransition(reduceMotion)} onLayout={() => tryScroll()}
        style={[styles.card, { backgroundColor: theme.surface }]}>
        {items.length === 0 ? (
          <Text {...mobileTextProps("body")} style={[styles.empty, { color: theme.textSecondary }]}>Nothing framed yet.</Text>
        ) : items.map((item, index) => {
          // Inset past the block and before the row's end (owner rule, 28 Oct 2026), as Today's rows.
          const divider = index > 0 ? <InsetDivider color={theme.border} edge="top" end={14} start={DIVIDER_INSET_PAST_BLOCK} /> : null;
          if (item.kind === "block") {
            const trip = trips.get(item.entry.entryId);
            const open = openLegs.has(item.entry.entryId);
            return (
              <Animated.View key={item.key} layout={localLayoutTransition(reduceMotion)} onLayout={() => tryScroll()}
                ref={(view: View | null) => { if (view) rowViews.current.set(item.key, view); else rowViews.current.delete(item.key); }}>
                <BlockRow entry={item.entry} legsOpen={open} nowMs={nowMs} onOpen={() => {
                  // A block with its own "?": "N to check" moves on from it.
                  const asked = blockChecks?.get(item.entry.entryId);
                  if (asked && item.entry.asking) lastOpenedCheckId.current = asked;
                  onOpenEntry(item.entry);
                }}
                  onToggleLegs={trip ? () => toggleLegs(item.entry.entryId) : undefined} route={trip?.route} legs={trip?.legs} theme={theme} time={time} />
                {trip && open ? (
                  <Animated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}>
                    <LegRows legs={trip.legs} onOpenLeg={onOpenTripLeg ? (index) => onOpenTripLeg(trip, index) : undefined} theme={theme} time={time} />
                  </Animated.View>
                ) : null}
              {divider}
              </Animated.View>
            );
          }
          return (
            <Animated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} key={item.key}
              layout={localLayoutTransition(reduceMotion)} onLayout={() => tryScroll()}
              ref={(view: View | null) => { if (view) rowViews.current.set(item.key, view); else rowViews.current.delete(item.key); }}
             >
              <LocationRow checkGlyphs={checkGlyphs} checkQuestions={checkQuestions} checkTitles={checkTitles}
                onOpenCheck={onOpenCheck ? (id) => { lastOpenedCheckId.current = id; onOpenCheck(id); } : undefined}
                onOpenPlace={onOpenPlace ? (place, label) => { lastOpenedCheckId.current = checkIdOf(item.row) ?? lastOpenedCheckId.current; onOpenPlace(place, label); } : undefined}
                onYes={onAnswerCheck ? (id) => answerCheck(id, true) : undefined}
                onToggleCheck={onAnswerCheck || onOpenCheck || onOpenTripLeg || onOpenPlace ? toggleCheck : undefined}
                openCheckId={shownOpenCheckId} row={item.row} sheetless={inlineIds.has(checkIdOf(item.row) ?? "")} theme={theme} time={time} />
              {(() => {
                // Only a row with no sheet (Apple Health) shows its question here (owner, 28 Oct 2026).
                const candidate = checkIdOf(item.row);
                const id = candidate && inlineIds.has(candidate) ? candidate : undefined;
                const question = id && id === shownOpenCheckId ? checkQuestions?.get(id) : undefined;
                return id && question ? (
                  <Animated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}>
                    <CheckQuestion onAnswer={(logged) => answerCheck(id, logged)} question={question} theme={theme} />
                  </Animated.View>
                ) : null;
              })()}
              {divider}
            </Animated.View>
          );
        })}
      </Animated.View>
      </View>
      </GestureDetector>
    </ScrollView>
  );
}

/** What a "?" is about (Codex r2 on #610): only "health" and "none" have no sheet. */
export type CalendarCheckKind = "health" | "place" | "trip" | "block" | "none";

/** How a place's or a trip's "?" opens its sheet: the place's sheet, the trip's (the caller routes it), or its screen. */
function sheetOpener(row: LocationListRow, checkId: string, { checkQuestions, onOpenCheck, onOpenPlace, onOpenTripLeg }: {
  checkQuestions?: ReadonlyMap<string, ReviewAnswerQuestion>; onOpenCheck?: (reviewItemId: string) => void;
  onOpenPlace?: (place: TimelinePlace, label: string) => void;
  onOpenTripLeg?: (trip: TimelineTrip & { route: string }, legIndex: number | null) => void;
}) {
  if (row.kind === "place") {
    if (onOpenPlace) return () => onOpenPlace(row.place, placeRowLabel(row, checkQuestions));
    return onOpenCheck ? () => onOpenCheck(checkId) : undefined;
  }
  if (row.kind !== "check" || !row.trip) return undefined;
  // The trip's own sheet, its "?" asked at the top; the caller's own route only when the List can't open it.
  const trip = row.trip;
  if (onOpenTripLeg) return () => onOpenTripLeg(trip, null);
  return onOpenCheck ? () => onOpenCheck(checkId) : undefined;
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
  const firstDetail = (entry.detailLines ?? []).find((line) => line.glyph !== "time" && line.text);
  // Owner item F (28 Oct 2026): a place line that only repeats the title ("PureGym" / "📍 PureGym") is dropped.
  const detail = firstDetail && firstDetail.text.trim().toLowerCase() === entry.title.trim().toLowerCase() ? undefined : firstDetail;
  return (
    <View style={styles.row}>
      <Pressable accessibilityHint={entry.asking ? "Opens the block with its question" : "Opens the block"} accessibilityLabel={[entry.accessibilityLabel, legs?.length ? modesLabel(legs, route) : null].filter(Boolean).join(". ")}
        accessibilityRole="button" onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, styles.blockRow, { opacity: pressed ? 0.7 : 1 }]}>
        {entry.isReview ? (
          <View style={[styles.blockMark, { height: markHeight, backgroundColor: theme.surfaceMuted }]}>
            <Text style={[styles.reviewMark, { color: theme.warningText }]}>?</Text>
          </View>
        ) : (
          <View style={[styles.blockMark, { height: markHeight, backgroundColor: entry.color }]}>
            <DayframeIcon color={entry.textColor} glyph={entry.glyph as DayframeGlyph} size={16} />
            {/* Location v4 design §7: a block with a "?" of its own (it ran into a trip) has the one amber dot. */}
            {entry.asking ? <View style={[styles.dot, { backgroundColor: theme.warning, borderColor: theme.surface }]} testID="calendar-list-block-asking" /> : null}
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
          {legs?.length ? <ModesLine legs={legs} legsOpen={legsOpen} onToggleLegs={onToggleLegs} route={route} theme={theme} /> : null}
        </View>
        <View style={styles.times}>
          <Text {...mobileTextProps("numeric")} style={[styles.time, { color: theme.textPrimary }]}>{time(entry.startedAtMs)}</Text>
          <Text {...mobileTextProps("numeric")} style={[styles.time, { color: theme.textSecondary }]}>{entry.stoppedAtMs == null ? "now" : time(entry.stoppedAtMs)}</Text>
        </View>
      </Pressable>
    </View>
  );
}

/** What VoiceOver reads for a trip's route and modes, inside its row's own label (Codex r1 on #570). */
function modesLabel(legs: readonly TripLeg[], route?: string) {
  return `${route ? `${route}. ` : ""}Legs: ${legs.map((leg) => legModeLabel(leg)).join(", ")}`;
}

/** Card D item 12: a trip's modes line shows at most three legs, then "+N" (its row's label names every leg). */
export const MODES_LINE_MAX_LEGS = 3;

/**
 * A trip's route on its own line and its modes on the next, the legs' toggle there (owner items C, G, 28 Oct
 * 2026); an unsure leg's name in amber. Read as part of its row; the toggle is its own button.
 */
function ModesLine({ legs, legsOpen, onToggleLegs, route, theme }: {
  legs: readonly TripLeg[]; legsOpen?: boolean; onToggleLegs?: () => void; route?: string; theme: MobileTheme;
}) {
  const more = legs.length - MODES_LINE_MAX_LEGS;
  const modes = (
    <View importantForAccessibility="no-hide-descendants" style={styles.modes}>
      {legs.slice(0, MODES_LINE_MAX_LEGS).map((leg, index) => (
        <View key={`${leg.startedAt}-${index}`} style={styles.mode}>
          <DayframeIcon color={leg.confidence === "unsure" ? theme.warningText : theme.textSecondary} glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={13} />
          <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: leg.confidence === "unsure" ? theme.warningText : theme.textSecondary }]}>
            {legModeLabel({ ...leg, runnerUp: undefined })}
          </Text>
        </View>
      ))}
      {more > 0 ? (
        <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]} testID="calendar-list-modes-more">+{more}</Text>
      ) : null}
      {onToggleLegs ? (
        <View style={[styles.mode, { transform: [{ rotate: legsOpen ? "270deg" : "90deg" }] }]}>
          <DayframeIcon color={theme.textSecondary} glyph="chevron-right" size={14} />
        </View>
      ) : null}
    </View>
  );
  return (
    <View style={styles.stackedModes}>
      {route ? <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>{route}</Text> : null}
      {onToggleLegs ? (
        <Pressable accessibilityLabel={`${legsOpen ? "Hide" : "Show"} the ${legs.length} legs`} accessibilityRole="button"
          accessibilityState={{ expanded: Boolean(legsOpen) }} hitSlop={8} onPress={onToggleLegs} style={styles.legsToggle}>
          {modes}
        </Pressable>
      ) : modes}
    </View>
  );
}

function LegRows({ legs, onOpenLeg, theme, time }: {
  legs: readonly TripLeg[]; onOpenLeg?: (index: number) => void; theme: MobileTheme; time: (ms: number) => string;
}) {
  return (
    <View accessibilityLabel="Legs" style={styles.legs}>
      {legs.map((leg, index) => {
        const minutes = Math.max(0, Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000));
        const detail = legDetail(leg);
        return (
          // A leg opens its trip's sheet at that leg, to change how you travelled (step 12).
          <Pressable key={`${leg.startedAt}-${index}`} accessibilityHint={onOpenLeg ? "Opens it to change how you travelled" : undefined}
            accessibilityLabel={`${legModeLabel(leg)}, ${formatDuration(minutes)}, from ${time(Date.parse(leg.startedAt))}`}
            accessibilityRole={onOpenLeg ? "button" : undefined} disabled={!onOpenLeg} onPress={() => onOpenLeg?.(index)}
            style={({ pressed }) => [styles.leg, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}
            testID={`calendar-list-leg-${index}`}>
            <DayframeIcon color={leg.confidence === "unsure" ? theme.warningText : theme.textSecondary} glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={16} />
            <View style={styles.text}>
              <Text {...mobileTextProps("itemTitle")} style={[styles.legTitle, { color: leg.confidence === "unsure" ? theme.warningText : theme.textPrimary }]}>
                {legModeLabel(leg)} · {formatDuration(minutes)}
              </Text>
              {detail ? <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{detail}</Text> : null}
            </View>
            <Text {...mobileTextProps("numeric")} style={[styles.meta, { color: theme.textSecondary }]}>{time(Date.parse(leg.startedAt))}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A place row's name: its place, or "Unclear place" / "Unknown place". */
function placeLabel(row: LocationListRow) {
  if (row.kind !== "place") return "";
  return row.place.name ?? (row.place.matchKind === "ambiguous" ? "Unclear place" : "Unknown place");
}

/** Owner Q7 (28 Oct 2026): an unnamed place that asks "Visited Boots?" (its name, or Apple's guess nearby) reads "Boots?". */
function placeGuess(row: LocationListRow, checkQuestions?: ReadonlyMap<string, ReviewAnswerQuestion>) {
  if (row.kind !== "place" || row.place.name || !row.checkIds[0]) return undefined;
  return /^Visited (.+)\?$/.exec(checkQuestions?.get(row.checkIds[0])?.question ?? "")?.[1];
}

/** The name a place row shows, and its sheet's title. */
function placeRowLabel(row: LocationListRow, checkQuestions?: ReadonlyMap<string, ReviewAnswerQuestion>) {
  const guess = placeGuess(row, checkQuestions);
  return guess ? `${guess}?` : placeLabel(row);
}

/**
 * Owner, 28 Oct 2026 (concern 1): a location row's mark is its normal icon in the usual filled square, with one
 * small amber dot when it asks something; no outline and no second "?" box.
 */
function RowMark({ asking, glyph, theme }: { asking: boolean; glyph: DayframeGlyph; theme: MobileTheme }) {
  // Item E: one tile for every row, the size of a block's mark.
  return (
    <View style={[styles.mark, styles.rowTile, { backgroundColor: theme.surfaceMuted }]}>
      <DayframeIcon color={theme.textSecondary} glyph={glyph} size={18} />
      {asking ? <View style={[styles.dot, { backgroundColor: theme.warning, borderColor: theme.surface }]} /> : null}
    </View>
  );
}

/**
 * A location row (owner feedback, 28 Oct 2026, items A–G): tapping a place or a trip opens its sheet straight
 * away, with its "?" asked at the top; a confident guess answers in one tap with the compact Yes pill on the row.
 * Every row has the same tile and the same right column (start over end), and the length is in the subtitle.
 * Apple Health questions have no sheet: tapping one opens its question under the row. The journey in progress
 * keeps its own row.
 */
function LocationRow({ checkGlyphs, checkQuestions, checkTitles, onOpenCheck, onOpenPlace, onToggleCheck, onYes, openCheckId, row, sheetless, theme, time }: {
  checkGlyphs?: ReadonlyMap<string, DayframeGlyph>; checkQuestions?: ReadonlyMap<string, ReviewAnswerQuestion>;
  checkTitles?: ReadonlyMap<string, string>; onOpenCheck?: (reviewItemId: string) => void;
  onOpenPlace?: (place: TimelinePlace, label: string) => void;
  /** Opens (or closes) an Apple Health "?"'s question under its row. */
  onToggleCheck?: (reviewItemId: string) => void;
  /** One-tap Yes on the row (item B), when the question has a confident answer. */
  onYes?: (reviewItemId: string) => void;
  openCheckId: string | null; row: LocationListRow;
  /** Its "?" opens under the row (Apple Health); otherwise it opens a sheet or its own screen. */
  sheetless: boolean;
  theme: MobileTheme; time: (ms: number) => string;
}) {
  // The row's Yes pill (item B): only for an answerable confident guess, a place's "Visited X?" (named or not) or a
  // trip's, with its log label (Codex r1 on #610). Apple Health answers in its question under the row.
  const yesFor = (checkId: string | undefined, kind: "place" | "trip") => {
    const question = checkId ? checkQuestions?.get(checkId) : undefined;
    if (!checkId || !onYes || !question?.logLabel) return null;
    return kind === "trip" || /^Visited .+\?$/.test(question.question) ? question.logLabel : null;
  };
  const YesPill = ({ checkId, label }: { checkId: string; label: string }) => (
    <Pressable accessibilityHint="Answers its question" accessibilityLabel={label} accessibilityRole="button" hitSlop={COMPACT_PILL_HIT_SLOP}
      onPress={() => onYes?.(checkId)} style={({ pressed }) => [compactPillStyles.pill, styles.yesPillGap, { backgroundColor: theme.textPrimary, opacity: pressed ? 0.8 : 1 }]}
      testID={`calendar-list-yes-${checkId}`}>
      <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: theme.background }]}>{label}</Text>
    </Pressable>
  );
  const Times = ({ fromMs, toMs, open }: { fromMs: number; toMs: number | null; open: boolean }) => (
    <View style={styles.times}>
      <Text {...mobileTextProps("numeric")} style={[styles.time, { color: theme.textPrimary }]}>{time(fromMs)}</Text>
      <Text {...mobileTextProps("numeric")} style={[styles.time, { color: theme.textSecondary }]}>{open || toMs == null ? "now" : time(toMs)}</Text>
    </View>
  );
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
  if (row.kind === "check") {
    const title = checkTitles?.get(row.checkId) ?? "Something to check";
    const fromMs = row.startedAt ? Date.parse(row.startedAt) : null;
    const toMs = row.stoppedAt ? Date.parse(row.stoppedAt) : null;
    const expanded = openCheckId === row.checkId;
    // A trip has its own sheet (never the question under its row); Apple Health opens its question here; a place's
    // or trip's still waiting for the day's places opens on its own screen (the caller routes it).
    const opens = onToggleCheck ? () => onToggleCheck(row.checkId) : undefined;
    const yes = row.trip ? yesFor(row.checkId, "trip") : null;
    return (
      <View style={styles.row}>
        <Pressable accessibilityHint={opens ? !sheetless ? row.trip ? "Opens the trip" : "Opens it" : expanded ? "Hides the question" : "Shows the question" : undefined}
          accessibilityLabel={[title, fromMs != null ? `${time(fromMs)} to ${toMs != null ? time(toMs) : "now"}` : null,
            row.trip ? modesLabel(row.trip.legs, row.trip.route) : null, "Needs a look"].filter(Boolean).join(". ")}
          accessibilityRole={opens ? "button" : undefined} accessibilityState={!sheetless || !opens ? undefined : { expanded }} disabled={!opens} onPress={opens}
          style={({ pressed }) => [styles.rowMain, styles.blockRow, { opacity: pressed ? 0.7 : 1 }]} testID={`calendar-list-check-${row.checkId}`}>
          <RowMark asking glyph={checkGlyphs?.get(row.checkId) ?? (row.trip ? DAYFRAME_APP_ICONS.openTrip : DAYFRAME_APP_ICONS.places)} theme={theme} />
          <View style={styles.text}>
            <Text {...mobileTextProps("itemTitle")} numberOfLines={2} style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
            {row.trip?.legs.length ? <ModesLine legs={row.trip.legs} route={row.trip.route} theme={theme} />
              : <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>
                {fromMs != null && toMs != null ? formatDuration(Math.round((toMs - fromMs) / 1000)) : "Apple Health"}</Text>}
            {yes ? <YesPill checkId={row.checkId} label={yes} /> : null}
          </View>
          {fromMs != null ? <Times fromMs={fromMs} open={toMs == null} toMs={toMs} /> : null}
        </Pressable>
      </View>
    );
  }
  if (row.kind !== "place") return null;
  const { place } = row;
  const checkId = row.checkIds[0];
  const label = placeRowLabel(row, checkQuestions);
  const open = place.stoppedAt == null;
  const length = Math.max(0, Math.round((row.spanEndMs - row.fromMs) / 1000));
  const asking = Boolean(checkId);
  // Item A: the place's sheet, its "?" asked at the top (never under the row); with no sheet, its own screen.
  const opens = onOpenPlace ? () => onOpenPlace(place, label) : asking && onOpenCheck ? () => onOpenCheck(checkId) : undefined;
  const glyph = place.role === "home" ? DAYFRAME_APP_ICONS.placeHome : place.role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places;
  const partly = row.unloggedSeconds >= 60 && row.unloggedSeconds < length - 59 ? `${formatDuration(row.unloggedSeconds)} not in a block` : null;
  // Item D: the length lives in the subtitle only.
  const detail = [formatDuration(length), partly, place.setByYou ? "You set this" : null].filter(Boolean).join(" · ");
  const yes = yesFor(checkId, "place");
  return (
    <View style={styles.row}>
      <Pressable accessibilityHint={opens ? "Opens the place" : undefined}
        accessibilityLabel={[label, `${time(row.fromMs)} to ${open ? "now" : time(row.spanEndMs)}`, detail, asking ? "Needs a look" : null].filter(Boolean).join(". ")}
        accessibilityRole={opens ? "button" : undefined} disabled={!opens} onPress={opens}
        style={({ pressed }) => [styles.rowMain, styles.blockRow, row.faint ? styles.quiet : null, { opacity: pressed ? 0.7 : 1 }]} testID={`calendar-list-place-${place.id}`}>
        <RowMark asking={asking} glyph={glyph} theme={theme} />
        <View style={styles.text}>
          <Text {...mobileTextProps("itemTitle")} style={[styles.title, { color: row.faint ? theme.textSecondary : theme.textPrimary }]}>{label}</Text>
          <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{detail}</Text>
          {yes && checkId ? <YesPill checkId={checkId} label={yes} /> : null}
        </View>
        <Times fromMs={row.fromMs} open={open} toMs={row.spanEndMs} />
      </Pressable>
    </View>
  );
}

/**
 * Apple Health's "?" question under its row (mock-up #ios-list; owner, 28 Oct 2026: only a row with no sheet
 * shows one): what it asks, why, and one-tap answers in the compact inline pills (32 points tall, each a
 * 44-point target) — the answer first, then the skip. Step 15: there is no Review screen any more, so it has no
 * "More…", "Edit" or "Open it"; a suggestion it can't answer (no complete time, or a change of its own waiting)
 * says why and offers nothing. Card D item 9 (owner, 25 Oct 2026): one style with the web — the standard inset
 * surface, the answer a neutral dark pill (textPrimary fill, background text), the skip surfaceMuted; coral stays
 * for Play/Stop and live recording.
 */
function CheckQuestion({ onAnswer, question, theme }: {
  onAnswer: (logged: boolean) => void; question: ReviewAnswerQuestion; theme: MobileTheme;
}) {
  return (
    <View style={[styles.question, { backgroundColor: theme.surfaceInset }]} testID="calendar-list-question">
      <Text {...mobileTextProps("itemTitle")} accessibilityRole="header" style={[styles.questionTitle, { color: theme.textPrimary }]}>{question.question}</Text>
      {/* Owner item I: the row already says the times, so a detail that only repeats them is dropped. */}
      {question.detail && !/\d:\d\d/.test(question.detail) ? (
        <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{question.detail}</Text>
      ) : null}
      {question.logLabel || question.skipLabel ? (
        <View style={[compactPillStyles.answers, styles.answersGap]}>
          {question.logLabel ? (
            <Pressable accessibilityRole="button" hitSlop={COMPACT_PILL_HIT_SLOP} onPress={() => onAnswer(true)} testID="calendar-list-answer-log"
              style={({ pressed }) => [compactPillStyles.pill, { backgroundColor: theme.textPrimary, opacity: pressed ? 0.8 : 1 }]}>
              <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: theme.background }]}>{question.logLabel}</Text>
            </Pressable>
          ) : null}
          {question.skipLabel ? (
            <Pressable accessibilityRole="button" hitSlop={COMPACT_PILL_HIT_SLOP} onPress={() => onAnswer(false)} testID="calendar-list-answer-skip"
              style={({ pressed }) => [compactPillStyles.pill, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.8 : 1 }]}>
              <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: theme.textPrimary }]}>{question.skipLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
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
  mark: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  // Calendar v3 rows (owner choice A): Today's block mark, top-aligned beside the text.
  blockRow: { alignItems: "flex-start" },
  blockMark: { width: ROW_BLOCK.width, borderRadius: DAYFRAME_BLOCKS.radius.chip, alignItems: "center", justifyContent: "center" },
  reviewMark: { fontSize: 16, fontWeight: "800" },
  detail: { flexDirection: "row", alignItems: "center", gap: 4 },
  detailText: { flexShrink: 1 },
  times: { alignItems: "flex-end", gap: 2 },
  time: { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: "700" },
  meta: { fontSize: 13 },
  modes: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 6, rowGap: 2 },
  mode: { flexDirection: "row", alignItems: "center", gap: 3 },
  legs: { gap: 6, paddingHorizontal: 14, paddingBottom: 12, paddingLeft: 62 },
  leg: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, minHeight: 44 },
  legTitle: { fontSize: 15, fontWeight: "700" },
  checksChip: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, borderRadius: DAYFRAME_BLOCKS.radius.pill, paddingHorizontal: 12 },
  checksChipText: { fontSize: 13, fontWeight: "700" },
  // Owner, 28 Oct 2026: the one amber dot on a row's mark (and on the chip), ringed in the card's surface.
  dot: { position: "absolute", top: -3, right: -3, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  quiet: { minHeight: 48, paddingVertical: 8 },
  rowTile: { width: ROW_BLOCK.width, height: 36 },
  stackedModes: { gap: 2 },
  legsToggle: { alignSelf: "flex-start", minHeight: 28, justifyContent: "center" },
  filter: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end", minHeight: 32, paddingHorizontal: 4 },
  filterText: { fontSize: 13, fontWeight: "600" },
  // The compact pill (owner, 28 Oct 2026) is compactPillStyles.pill; COMPACT_PILL_HIT_SLOP keeps 44 points.
  yesPillGap: { marginTop: 6 },
  question: { marginHorizontal: 14, marginBottom: 12, marginLeft: 62, borderRadius: 14, padding: 12, gap: 4 },
  questionTitle: { fontSize: 15, fontWeight: "700" },
  // compactPillStyles.answers keeps room between rows of pills for their 44-point targets.
  answersGap: { marginTop: 8 }
});
