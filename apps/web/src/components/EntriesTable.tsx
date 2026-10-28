"use client";

import {
  Fragment,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Minus } from "lucide-react";
import { analyzeTimeIntervals, resolveActivityIcon, type ClockFormat, type TimeIntervalAnalysisEntry } from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { useAppShellRuntime } from "@/components/AppShellRuntime";
import { useIsHydrated } from "@/components/useHydrationSafeNow";
import { DatePickerPopover } from "@/components/DatePickerPopover";
import { saveTimeEntryQuickEdit, TimeEntryQuickEditorModal } from "@/components/TimeEntryQuickEditor";
import { TagMetadata } from "@/components/TagMetadata";
import { clientFetch } from "@/lib/client-auth-fetch";
import { duplicateTimeEntry, splitTimeEntry } from "@/lib/time-entry-split";
import { timeEntryTitle } from "@/lib/display";
import type { CategoryRow, ReviewItemRow, TagRow, TimeEntryRow } from "@/lib/queries";
import { prefersReducedMotion } from "@/lib/blocks-motion";
import {
  dateTimeLocal,
  formatDate,
  formatDuration,
  formatTime
} from "@/lib/format";
import { useClockFormat } from "@/components/ClockFormat";
import { displayTypedTime } from "@/lib/calendar-grid";
import { timelineEntryDisplayInterval } from "@/lib/timeline-calculations";
import { groupTimelineEntriesByDay, timelineEntryGroupKey } from "@/lib/timeline-entry-groups";
import {
  buildTimelineInlineSavePlan,
  createTimelineInlineEditDraft,
  updateTimelineInlineDate,
  updateTimelineInlineDescription,
  updateTimelineInlineTime,
  type TimelineInlineEditDraft,
  type TimelineInlineEditField,
  type TimelineInlineTimeEdge
} from "@/lib/timeline-inline-edit";
import type { DateRange } from "@/lib/time-entry-overlap";
import { checkAskingStartMs, checkStillAsks, checksOldestFirst, hasLocationPlaces, visitedGuess, locationListRows, tripsByBlockId, type LocationListRow, type LocationTimeline, type TimelinePlace, type TimelineTrip, type TripLeg } from "@dayframe/shared";
import { useLocalDayStartMs, useMediaQuery } from "@/components/useCalendarClock";
import { PLACES_COLUMN_STORAGE_KEY, readStoredFlag, SHOW_ALL_PLACES_STORAGE_KEY, storeFlag } from "@/lib/calendar-preferences";
import { PlacesColumn } from "@/components/location/PlacesColumn";
import { LocationCorrectionDialog, type CorrectionPlace, type LocationCorrectionTarget } from "@/components/location/LocationCorrectionDialog";
import { CheckQuestionRow, checkQuestionWords, CheckRowView, ChecksChip, useListChecks } from "@/components/location/ListChecks";
import { reviewPicture } from "@/lib/review-deck";
import { BlocksToast } from "@/components/blocks/BlocksToast";
import { ErrorBanner } from "@/components/blocks/ErrorBanner";
import { blockStyle } from "@/lib/block-style";
import { blockRowHeight } from "@/lib/today-view";
import {
  LocationListRowView,
  TripLegRows,
  TripLegsToggle,
  TripModesLine
} from "@/components/location/LocationListRows";

type TimelineInlineEditorState = TimelineInlineEditDraft & {
  entryId: string;
  error: string | null;
  isSaving: boolean;
  sessionId: number;
  target: TimelineInlineEditTarget;
};

type TimelineInlineEditTarget = {
  day: string | null;
  entryIds: string[];
  groupKey: string | null;
  kind: "entry" | "group";
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

type OptimisticDescription = {
  description: string | null;
  sourceDescription: string | null;
  sourceUpdatedAt: string;
};

async function saveGroupedTimeEntryDescription(entryIds: string[], description: string | null) {
  try {
    const response = await clientFetch("/api/time-entries/batch-description", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: entryIds, description })
    });
    if (!response.ok) {
      let message = `Unable to update this group: ${response.status}`;
      try {
        const payload = (await response.json()) as { error?: string };
        message = payload.error ?? message;
      } catch {
        // Keep the status fallback when the response is not JSON.
      }
      return { ok: false, error: message } as const;
    }
    return { ok: true } as const;
  } catch {
    return { ok: false, error: "Unable to update this group. Check your connection and try again." } as const;
  }
}

function applyTimelineRegroup(update: () => void) {
  const documentWithTransitions = document as ViewTransitionDocument;
  if (typeof window.matchMedia !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !documentWithTransitions.startViewTransition) {
    update();
    return;
  }
  documentWithTransitions.startViewTransition(() => flushSync(update));
}

function TimelineInlineTimeControl({
  date,
  disabled,
  edge,
  entryId,
  entryTitle,
  onBeginEdit,
  onDateChange,
  onKeyDown,
  onPickerOpenChange,
  onTimeChange,
  today,
  typedValue,
  value,
  readOnly
}: {
  date: string;
  disabled?: boolean;
  edge: TimelineInlineTimeEdge;
  entryId: string;
  entryTitle: string;
  onBeginEdit: () => void;
  onDateChange: (date: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onPickerOpenChange: (open: boolean) => void;
  onTimeChange: (time: string) => void;
  readOnly: boolean;
  today: string;
  /** The draft's own text while editing (null otherwise). */
  typedValue: string | null;
  value: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // From the first key until the field is left it shows exactly what was typed; formatted
  // ("9:30 PM") only otherwise, so " AM" is never added under the caret (Codex r2 on #446).
  const [typing, setTyping] = useState(false);
  const clock = useClockFormat();
  const edgeLabel = edge === "start" ? "Start" : "Finish";
  const panelId = `timeline-inline-date-${entryId}-${edge}`;

  function updateDatePickerOpen(open: boolean) {
    setDatePickerOpen(open);
    onPickerOpenChange(open);
  }

  return (
    <span className="timeline-inline-time-control">
      <input
        aria-controls={panelId}
        aria-expanded={datePickerOpen}
        aria-haspopup="dialog"
        aria-label={`${edgeLabel} time for ${entryTitle}`}
        className="timeline-inline-time-input"
        data-inline-entry-id={entryId}
        data-inline-field="time"
        disabled={disabled}
        inputMode={clock === "12h" ? "text" : "numeric"}
        maxLength={8}
        onBlur={() => setTyping(false)}
        onChange={(event) => {
          setTyping(true);
          onTimeChange(event.target.value);
        }}
        onClick={() => {
          onBeginEdit();
          updateDatePickerOpen(true);
        }}
        onFocus={onBeginEdit}
        onKeyDown={onKeyDown}
        readOnly={readOnly}
        ref={inputRef}
        role="combobox"
        data-tip={`Edit ${edgeLabel.toLowerCase()} time and choose its date`}
        type="text"
        value={typing && typedValue !== null ? typedValue : value}
      />
      <DatePickerPopover
        anchorRef={inputRef}
        ariaLabel={`Choose ${edgeLabel} date, currently ${formatDate(`${date}T12:00:00`)}`}
        className="timeline-inline-date-picker"
        disabled={disabled}
        label={formatDate(`${date}T12:00:00`)}
        onChange={onDateChange}
        onOpenChange={updateDatePickerOpen}
        open={datePickerOpen}
        panelId={panelId}
        panelClassName="timeline-inline-date-picker-panel"
        panelLabel={`Choose ${edgeLabel} date`}
        portal
        max={today}
        showTrigger={false}
        today={today}
        value={date}
      />
    </span>
  );
}

const NO_CORRECTION_PLACES: readonly CorrectionPlace[] = [];
const NO_REVIEW_ITEMS: readonly ReviewItemRow[] = [];

/** Calendar › List's continuous days (owner, 24 Oct 2026): what the List needs to load weeks at either end. */
export type ContinuousListProps = {
  loading: "earlier" | "later" | null;
  error: "earlier" | "later" | null;
  reachedEarliest: boolean;
  reachedLatest: boolean;
  onLoad: (direction: "earlier" | "later") => void;
  /** The selected day: the List scrolls its heading (or the nearest earlier one) to the top on each request. */
  focusDayStartMs: number;
  /** A new value asks for the scroll again (the selected day's key). */
  focusRequest: string;
};

/** How far ahead of either end the List starts loading the next week. */
const CONTINUOUS_LOAD_MARGIN_PX = 600;

/** A day with nothing from location: its checks are then rows of their own. */
function emptyDayTimeline(day: DateRange): LocationTimeline {
  return { date: "", timeZone: "", dayStart: day.start.toISOString(), dayEnd: day.end.toISOString(), items: [], openTrip: null, gaps: [] };
}

export function EntriesTable({
  entries,
  categories,
  tags = [],
  groupByDay = false,
  onDeleteEntries,
  onChanged,
  onScroll,
  scrollContainerRef,
  displayRange,
  capturedNow = new Date(),
  locationTimeline = null,
  locationTimelines,
  places = NO_CORRECTION_PLACES,
  reviewItems = NO_REVIEW_ITEMS,
  checksDay = null,
  checksDays,
  continuous
}: {
  entries: TimeEntryRow[];
  categories: CategoryRow[];
  tags?: TagRow[];
  groupByDay?: boolean;
  onDeleteEntries: (entries: readonly TimeEntryRow[]) => void;
  onChanged?: () => Promise<void>;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: (element: HTMLDivElement | null) => void;
  displayRange?: DateRange;
  capturedNow?: Date;
  /** The shown day's location timeline (location v4 step 10); null for a week, or until it loads. */
  locationTimeline?: LocationTimeline | null;
  /** Saved places a location row can be corrected to (location v4 step 13). */
  places?: readonly CorrectionPlace[];
  /** Open suggestions, each a "?" on the day's row it is about (location v4 step 14). */
  reviewItems?: readonly ReviewItemRow[];
  /** The shown day in day scope, so its checks show without the location read; null otherwise. */
  checksDay?: DateRange | null;
  /**
   * Calendar › List's continuous days: every shown day's location timeline, in place of
   * `locationTimeline`, in read order (oldest read first), so a trip read on two days shows its freshest copy.
   */
  locationTimelines?: readonly LocationTimeline[];
  /** Every shown day, so each day's checks show without its location read, in place of `checksDay`. */
  checksDays?: readonly DateRange[];
  /** Calendar › List's continuous days: loads weeks at either end as the List scrolls. */
  continuous?: ContinuousListProps;
}) {
  const router = useRouter();
  const clock = useClockFormat();
  const searchParams = useSearchParams();
  const {
    clearTimerError,
    createCategory,
    isTimerBusy,
    shellData,
    startEntryAgain,
    updateActiveEntryFromCalendar
  } = useAppShellRuntime();
  const [isPending, startTransition] = useTransition();
  const [editingEntry, setEditingEntry] = useState<TimeEntryRow | null>(null);
  const [inlineEditor, setInlineEditor] = useState<TimelineInlineEditorState | null>(null);
  const [inlineStatus, setInlineStatus] = useState<string | null>(null);
  const [optimisticDescriptions, setOptimisticDescriptions] = useState<Map<string, OptimisticDescription>>(() => new Map());
  const [actionError, setActionError] = useState<string | null>(null);
  const [continuingEntryId, setContinuingEntryId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  const inlineEditorRef = useRef<TimelineInlineEditorState | null>(null);
  const [openInlineDatePickerKey, setOpenInlineDatePickerKey] = useState<string | null>(null);
  const inlineSessionRef = useRef(0);
  const highlightedEntryId = searchParams.get("entry");
  // Every row is grouped under, and shows times in, the browser's local days, which the server
  // render can't know (Vercel renders in UTC). The server render and the hydration pass draw the
  // empty list; the rows appear once the page has hydrated, without motion (React #418).
  const localTimeReady = useIsHydrated();
  const listEntries = localTimeReady ? entries : NO_LIST_ENTRIES;
  // "All places" is remembered on this device (owner, 28 Oct 2026, concern 3). The List's
  // location rows draw only after hydration, so reading storage on the first client render is safe.
  const [showEveryPlace, setShowEveryPlaceState] = useState(() => typeof window !== "undefined"
    ? readStoredFlag(SHOW_ALL_PLACES_STORAGE_KEY, false) : false);
  // Card F (owner, 28 Oct 2026): on wide web a "Places and trips" column sits beside the blocks, remembered on this device.
  const [placesColumn, setPlacesColumnState] = useState(() => typeof window === "undefined" || readStoredFlag(PLACES_COLUMN_STORAGE_KEY, true));
  const wide = useMediaQuery("(min-width: 1200px)");
  const setPlacesColumn = (next: boolean) => {
    setPlacesColumnState(next);
    storeFlag(PLACES_COLUMN_STORAGE_KEY, next);
  };
  const columnShown = wide && placesColumn && localTimeReady;
  // The day at the top of the List, whose places the column shows.
  const [columnDayStartMs, setColumnDayStartMs] = useState<number | null>(null);
  const setShowEveryPlace = (update: (current: boolean) => boolean) => setShowEveryPlaceState((current) => {
    const next = update(current);
    storeFlag(SHOW_ALL_PLACES_STORAGE_KEY, next);
    return next;
  });
  const [expandedTrips, setExpandedTrips] = useState<Set<string>>(() => new Set());
  const [correction, setCorrection] = useState<LocationCorrectionTarget | null>(null);
  // Where focus goes if a saved correction (Logs as, Save this place, a fix) removes the row that opened its
  // dialog: the next "?" down the List from that row, else the chip, else the List (Codex r4 on #609).
  const correctionFocus = useRef<{ nextKey: string | null; saved: boolean } | null>(null);
  const openCorrection = (next: LocationCorrectionTarget) => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const following = opener ? [...document.querySelectorAll<HTMLElement>("[data-check-key]")]
      .find((element) => element !== opener && Boolean(opener.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) : undefined;
    correctionFocus.current = { nextKey: following?.dataset.checkKey ?? null, saved: false };
    setCorrection(next);
  };
  // The "?" the open dialog asks at its top, if it was opened from one (owner item A).
  const [correctionCheckId, setCorrectionCheckId] = useState<string | null>(null);
  // A place a trip comes into and another leaves: "I wasn't here" joins those trips (step 12 part 4).
  const correctPlace = (place: TimelinePlace, label: string) => {
    const trips = (locationTimelines ?? (locationTimeline ? [locationTimeline] : []))
      .flatMap((timeline) => timeline.items.filter((item) => item.kind === "trip"));
    const joinsTrips = trips.some((trip) => trip.toId === place.id) && trips.some((trip) => trip.fromId === place.id);
    openCorrection({ kind: "place", place, label, joinsTrips });
  };
  const correctLeg = (tripId: string, legs: readonly TripLeg[]) => (index: number) =>
    openCorrection({ kind: "leg", tripId, leg: legs[index], index, count: legs.length });
  const nowMs = capturedNow.getTime();
  const listChecks = useListChecks({ applyTransition: applyTimelineRegroup, categories, refresh: async () => { await onChanged?.(); }, reviewItems });
  // Owner concern 4 (28 Oct 2026): only "?" from today and the 6 days before ask; an older one's place stays a
  // plain row. The chip counts and steps through all of them, oldest first, across days.
  const todayStartMs = useLocalDayStartMs();
  const askingStartMs = todayStartMs === null ? null : checkAskingStartMs(todayStartMs);
  const shownChecks = useMemo(() => askingStartMs !== null ? listChecks.checks.filter((check) => checkStillAsks(check, askingStartMs)) : [],
    [askingStartMs, listChecks.checks]);
  const askingOrder = useMemo(() => checksOldestFirst(shownChecks), [shownChecks]);
  // The open question, by its suggestion: it stays open when its row is replaced, as when the day's places
  // arrive after the bootstrap (Codex r1 on #572).
  const [focusedCheck, setOpenCheck] = useState<string | null>(null);
  const setFocusedCheck = setOpenCheck;
  // Read-only location rows in time order beside the blocks (placement A); none before hydration.
  // One timeline per shown day: the day's location read, or (without it) an empty day so its checks still
  // show on rows of their own (Codex r1 on #568).
  const dayTimelines = useMemo(() => {
    const timelines = locationTimelines ?? (locationTimeline ? [locationTimeline] : []);
    const days = checksDays ?? (checksDay ? [checksDay] : []);
    const read = new Set(timelines.map((timeline) => Date.parse(timeline.dayStart)));
    return [...timelines, ...days.filter((day) => !read.has(day.start.getTime())).map(emptyDayTimeline)];
  }, [checksDay, checksDays, locationTimeline, locationTimelines]);
  // Each row belongs to the day it was read for (a place spanning midnight is a row on each day, clipped
  // to it), placed at its time within that day. A suggestion is one "?": on its place row when any day
  // has one (the newest), otherwise on its own newest row (Codex r1 on #584).
  const locationRows = useMemo((): DayLocationRow[] => {
    if (!localTimeReady) return [];
    const days = dayTimelines
      .map((timeline) => ({
        dayStartMs: Date.parse(timeline.dayStart),
        dayLabel: formatDate(timeline.dayStart),
        rows: locationListRows(timeline, entries, { nowMs, showAll: showEveryPlace && !columnShown, checks: shownChecks, hideCovered: true })
      }))
      .sort((a, b) => b.dayStartMs - a.dayStartMs);
    const onPlace = new Set<string>();
    const out: DayLocationRow[] = [];
    for (const day of days) {
      for (const row of day.rows) {
        if (row.kind !== "place") continue;
        const checkIds = row.checkIds.filter((id) => !onPlace.has(id));
        for (const id of checkIds) onPlace.add(id);
        out.push({ ...row, checkIds, key: `${row.key}@${day.dayStartMs}`, atMs: row.fromMs, dayLabel: day.dayLabel, dayStartMs: day.dayStartMs });
      }
    }
    const seenChecks = new Set<string>();
    let openTrip = false;
    for (const day of days) {
      for (const row of day.rows) {
        if (row.kind === "check") {
          if (onPlace.has(row.checkId) || seenChecks.has(row.checkId)) continue;
          seenChecks.add(row.checkId);
        } else if (row.kind === "open_trip") {
          if (openTrip) continue;
          openTrip = true;
        } else {
          continue;
        }
        const atMs = Number.isFinite(row.atMs) ? Math.max(row.atMs, day.dayStartMs) : day.dayStartMs;
        out.push({ ...row, atMs, dayLabel: day.dayLabel, dayStartMs: day.dayStartMs });
      }
    }
    return out.sort((a, b) => b.atMs - a.atMs || a.key.localeCompare(b.key));
  }, [columnShown, dayTimelines, entries, localTimeReady, nowMs, shownChecks, showEveryPlace]);
  // A trip read on two days (it spans midnight): the freshest copy wins. `locationTimelines` come in
  // read order (oldest read first), so the last one read is last here (Codex r2, r5 on #584).
  const tripByBlock = useMemo(
    () => new Map(dayTimelines.flatMap((timeline) => [...tripsByBlockId(timeline)])),
    [dayTimelines]
  );
  // Continuous days: a sentinel at each end loads the next week as it nears the view.
  const earlierSentinelRef = useRef<HTMLDivElement | null>(null);
  const laterSentinelRef = useRef<HTMLDivElement | null>(null);
  const continuousLoading = continuous?.loading ?? null;
  const continuousError = continuous?.error ?? null;
  const onContinuousLoad = continuous?.onLoad;
  const loadsEarlier = Boolean(continuous && !continuous.reachedEarliest);
  const loadsLater = Boolean(continuous && !continuous.reachedLatest);
  useEffect(() => {
    const root = listScrollRef.current;
    if (!root || !onContinuousLoad || continuousLoading || continuousError || !localTimeReady || typeof IntersectionObserver === "undefined") return;
    // A new observer reports where each sentinel is now, so a week that still leaves it in view loads the next.
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        if (!record.isIntersecting) continue;
        onContinuousLoad(record.target === laterSentinelRef.current ? "later" : "earlier");
        return;
      }
    }, { root, rootMargin: `${CONTINUOUS_LOAD_MARGIN_PX}px 0px` });
    if (loadsEarlier && earlierSentinelRef.current) observer.observe(earlierSentinelRef.current);
    if (loadsLater && laterSentinelRef.current) observer.observe(laterSentinelRef.current);
    return () => observer.disconnect();
  }, [continuousError, continuousLoading, loadsEarlier, loadsLater, localTimeReady, onContinuousLoad]);
  // The selected day's positioning request (see below); while it is pending, anchoring waits.
  const focusDoneRef = useRef<string | null>(null);
  const focusRequest = continuous?.focusRequest ?? null;
  const focusDayStartMs = continuous?.focusDayStartMs ?? null;
  const focusCanGrow = Boolean(continuous && !continuous.reachedEarliest);
  const focusPending = () => focusRequest !== null && focusDoneRef.current !== focusRequest;
  // What is in view stays in place when rows are added above it (a later week, a day's places arriving):
  // the first row in view keeps its position, in every browser (the List turns native anchoring off).
  // Found by a binary search over the rows (they are in top order) and reconciled after every render: a
  // change can move rows above it without changing the List's height (a block moving between two shown
  // days, Codex r6 on #584), and one anchor measurement is cheap, so nothing rescans the loaded history.
  // `contentTop`: the row's offset within the List's content, so a shift is measured apart from scrolling.
  // `selector` finds the same row again when React remounts it (a day heading is keyed by its newest block).
  const scrollAnchorRef = useRef<{ element: Element; selector: string | null; contentTop: number } | null>(null);
  const recordScrollAnchor = () => {
    const root = listScrollRef.current;
    if (!root || !continuous) return;
    const rootTop = root.getBoundingClientRect().top;
    const rows = root.querySelectorAll("tbody > tr");
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (rows[mid].getBoundingClientRect().bottom > rootTop + 1) high = mid;
      else low = mid + 1;
    }
    const element = rows[low];
    scrollAnchorRef.current = element
      ? { element, selector: listRowSelector(element), contentTop: element.getBoundingClientRect().top - rootTop + root.scrollTop }
      : null;
  };
  const anchorFrameRef = useRef<number | null>(null);
  /** Card F: the column follows the day whose heading is at (or last passed) the top of the List. */
  const trackColumnDay = () => {
    const root = listScrollRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + 48;
    const headings = [...root.querySelectorAll<HTMLElement>("tr[data-day-start-ms]")];
    const passed = headings.filter((heading) => heading.getBoundingClientRect().top <= top);
    const heading = passed[passed.length - 1] ?? headings[0];
    const dayStart = heading ? Number(heading.dataset.dayStartMs) : NaN;
    if (Number.isFinite(dayStart)) setColumnDayStartMs((current) => current === dayStart ? current : dayStart);
  };
  useEffect(() => () => {
    if (anchorFrameRef.current !== null) cancelAnimationFrame(anchorFrameRef.current);
  }, []);
  useLayoutEffect(() => {
    const root = listScrollRef.current;
    const anchor = scrollAnchorRef.current;
    if (!root || !continuous) return;
    // The selected day is still being brought to the top: that, not the anchor, decides the position.
    if (focusPending()) return;
    // Also at the very top: a later week loading there must not pull the List up to today.
    const element = anchor
      ? anchor.element.isConnected ? anchor.element : anchor.selector ? root.querySelector(anchor.selector) : null
      : null;
    if (anchor && element) {
      const moved = element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - anchor.contentTop;
      if (Math.abs(moved) >= 1) root.scrollTop += moved;
    }
    recordScrollAnchor();
  });
  // The selected day's heading (or the nearest earlier one: the List is newest first) at the top, once
  // per request. The request stays pending until the heading really reaches the top: while too little of
  // the List lies below it the browser clamps the scroll, so it is tried again as earlier weeks arrive.
  // It ends when it lands, when no earlier week can come, or at the person's own scrolling (wheel, touch,
  // a key or the scrollbar), which always wins (Codex r3 on #584).
  const endFocusOnUserScroll = () => {
    if (!focusPending()) return;
    focusDoneRef.current = focusRequest;
    recordScrollAnchor();
  };
  useLayoutEffect(() => {
    const root = listScrollRef.current;
    if (!root || focusRequest === null || focusDayStartMs === null || focusDoneRef.current === focusRequest || !localTimeReady) return;
    const headings = [...root.querySelectorAll<HTMLElement>("tr[data-day-start-ms]")];
    if (!headings.length) return;
    const target = headings.find((heading) => Number(heading.dataset.dayStartMs) <= focusDayStartMs);
    if (!target) {
      // Every shown day is later than the selected one: rest at the bottom, where earlier weeks load,
      // and keep waiting for the nearest earlier day while one can still come (Codex r4 on #584).
      root.scrollTop = root.scrollHeight;
      if (!focusCanGrow) focusDoneRef.current = focusRequest;
    } else {
      // Measured like any heading, the first too: the "N to check" chip and the later edge sit above the
      // table (Codex r9 on #584).
      root.scrollTop += target.getBoundingClientRect().top - root.getBoundingClientRect().top;
      const off = target.getBoundingClientRect().top - root.getBoundingClientRect().top;
      if (Math.abs(off) < 1 || !focusCanGrow) focusDoneRef.current = focusRequest;
    }
    recordScrollAnchor();
  });
  /** The open suggestion a location row's "?" is about, if any. */
  const checkOf = (row: LocationListRow) => {
    const id = row.kind === "check" ? row.checkId : row.kind === "place" ? row.checkIds[0] : undefined;
    return id ? listChecks.itemsById.get(id) : undefined;
  };
  const checkRows = locationRows.filter((row) => checkOf(row));
  /** Whether a "?" row opens a dialog (a place, or a trip) rather than its question under it. */
  const opensDialog = (row: LocationListRow) => row.kind === "place" || (row.kind === "check" && Boolean(row.trip || row.place));
  /** Opens a "?" by its row and brings the row into view. */
  const openCheckRow = (next: LocationListRow) => {
    const nextId = checkOf(next)!.id;
    applyTimelineRegroup(() => setFocusedCheck(nextId));
    // Owner item A: a place or a trip opens its dialog with the "?" at the top; Apple Health opens under its row.
    if (next.kind === "place") openPlaceDialog(next.place, next.checkIds[0] ?? null);
    else if (next.kind === "check" && next.place) openPlaceDialog(next.place, next.checkId);
    else if (next.kind === "check" && next.trip) openTripDialog(next.checkId, next.trip);
    const anchor = next.kind === "place" ? next.place.id : next.key;
    requestAnimationFrame(() => [...document.querySelectorAll<HTMLElement>("[data-location-row]")]
      .find((element) => element.dataset.locationRow === anchor)
      ?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" }));
    return nextId;
  };
  /**
   * Owner concern 4 (28 Oct 2026): "N to check" steps oldest first through every "?" that still asks, across
   * days. A "?" on a day the List hasn't loaded opens that day (the List then opens it, see `check=` below).
   */
  const nextAskingCheck = () => {
    if (!askingOrder.length) return null;
    const at = askingOrder.findIndex((check) => check.id === focusedCheck);
    const next = askingOrder[(at + 1) % askingOrder.length];
    const row = checkRows.find((other) => checkOf(other)?.id === next.id);
    if (row) return openCheckRow(row);
    const day = new Date(next.startedAt ?? nowMs);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    // Remembered as the current one, so the next press goes on from it even before (or without) the day loading.
    setFocusedCheck(next.id);
    router.push(`/timeline?view=list&scope=day&date=${key}&check=${encodeURIComponent(next.id)}`);
    return next.id;
  };
  /** "N to check": the next "?", oldest first across days, opens and comes into view. Returns its id. */
  const nextCheck = () => nextAskingCheck();
  /** A place's dialog (owner item A): its "?" at the top, and logging it there closes the "?". */
  const openPlaceDialog = (place: TimelinePlace, checkId: string | null) => {
    setCorrectionCheckId(checkId);
    correctPlace(place, place.name ?? (place.matchKind === "ambiguous" ? "Unclear place" : "Unknown place"));
  };
  const openTripDialog = (checkId: string | null, trip: TimelineTrip & { route: string }) => {
    setCorrectionCheckId(checkId);
    openCorrection({ kind: "trip", trip, route: trip.route });
  };
  /** A location row, its "?" and, while open, an Apple Health question (no dialog) under it. */
  const renderLocationRow = (row: LocationListRow) => {
    const item = checkOf(row);
    const expanded = Boolean(item) && focusedCheck === item?.id;
    // The List's own transition owns every change a "?" makes (open, close, answer, Undo); none with Reduce Motion.
    const check = item ? { expanded, onToggle: () => applyTimelineRegroup(() => setFocusedCheck((current) => current === item.id ? null : item.id)) }
      : undefined;
    return (
      <Fragment key={row.key}>
        {row.kind === "check"
          ? item && check ? <CheckRowView check={check} clock={clock} item={item} row={row}
            // A covered place's "?" keeps its place: its dialog, map and Save this place (Codex r2 on #609).
            onOpen={row.place ? () => openPlaceDialog(row.place!, item.id) : row.trip ? () => openTripDialog(item.id, row.trip!) : undefined}
            onYes={checkQuestionWords(item, clock).confident ? () => applyTimelineRegroup(() => listChecks.answer(item.id, "log")) : undefined} />
            : null
          : <LocationListRowView check={check} clock={clock} guess={item && reviewPicture(item) === "place" ? visitedGuess(item.title) : null}
            nowMs={nowMs} row={row}
            onCorrect={row.kind === "place" ? () => openPlaceDialog(row.place, row.checkIds[0] ?? null) : undefined}
            onYes={item && checkQuestionWords(item, clock).confident ? () => applyTimelineRegroup(() => listChecks.answer(item.id, "log")) : undefined} />}
        {/* Owner final change 1 (28 Oct 2026): a row that opens a dialog shows no question under it (the dialog asks
            it); Apple Health, which has no dialog, asks here with the compact pills. */}
        {item && expanded && row.kind === "check" && !row.trip && !row.place ? (
          <CheckQuestionRow clock={clock} item={item}
            onAnswer={(kind) => {
              // Focus goes to the next "?" down the List, else the chip, else the List itself (Codex r1 on #568).
              const following = checkRows.slice(checkRows.findIndex((other) => other.key === row.key) + 1).find((other) => other.key !== row.key);
              applyTimelineRegroup(() => {
                listChecks.answer(item.id, kind);
                setFocusedCheck(null);
              });
              focusCheck(following?.key ?? null);
            }} />
        ) : null}
      </Fragment>
    );
  };
  /**
   * Where focus goes once the List has committed the change (a transition commits later): a row's "?" by
   * its key, else the chip, else the List itself (Codex r1/r2 on #568). Undefined: nothing to move.
   */
  const pendingFocus = useRef<string | null | undefined>(undefined);
  // Undo or a refused save brings a "?" back, or the Today link opens one: its toggle takes focus once its
  // row is listed (again).
  const pendingRestore = useRef<string | null>(null);
  const focusedToggleItem = useRef<string | null>(null);
  const focusCheck = (key: string | null) => {
    pendingRestore.current = null;
    pendingFocus.current = key;
  };
  // Only while it still asks (the asking list): past midnight on its 7th day the dialog stops asking it (Codex r2 on #609).
  const dialogCheck = correctionCheckId && shownChecks.some((check) => check.id === correctionCheckId)
    ? listChecks.itemsById.get(correctionCheckId) : undefined;
  const dialogWords = dialogCheck ? checkQuestionWords(dialogCheck, clock) : null;
  /**
   * A dialog's "?" answered: held for Undo like an inline answer; focus then goes to the next "?" down the List,
   * else the chip, else the List, as there (Codex r1 on #609: the row that opened the dialog is gone).
   */
  const answerFromDialog = (checkId: string, yes: boolean) => {
    const at = checkRows.findIndex((other) => checkOf(other)?.id === checkId);
    const following = at < 0 ? undefined : checkRows.slice(at + 1).find((other) => other.key !== checkRows[at].key);
    applyTimelineRegroup(() => listChecks.answer(checkId, yes ? "log" : "skip"));
    focusCheck(following?.key ?? null);
  };
  const restoredItemId = listChecks.state.restored?.itemId ?? null;
  const restoredSequence = listChecks.state.restored?.sequence ?? 0;
  useEffect(() => {
    if (restoredSequence && restoredItemId) pendingRestore.current = restoredItemId;
  }, [restoredItemId, restoredSequence]);
  useEffect(() => {
    if (pendingRestore.current) {
      const restoredId = pendingRestore.current;
      const restoredRow = locationRows.find((row) => (row.kind === "check" ? row.checkId : row.kind === "place" ? row.checkIds[0] : null) === restoredId);
      if (!restoredRow) return;
      pendingRestore.current = null;
      pendingFocus.current = restoredRow.key;
    }
    const key = pendingFocus.current;
    if (key === undefined) {
      // A "?" that held focus was replaced by its suggestion's new row (the day's places arrived): focus follows it.
      const lost = !document.activeElement || document.activeElement === document.body;
      const itemId = focusedToggleItem.current;
      const moved = lost && itemId ? checkRows.find((row) => checkOf(row)?.id === itemId) : undefined;
      if (moved) [...document.querySelectorAll<HTMLElement>("[data-check-key]")].find((element) => element.dataset.checkKey === moved.key)?.focus();
      return;
    }
    const row = key ? [...document.querySelectorAll<HTMLElement>("[data-check-key]")].find((element) => element.dataset.checkKey === key) : null;
    // Wait while the "?" it moves to has not rendered yet.
    if (key && !row && checkRows.some((other) => other.key === key)) return;
    pendingFocus.current = undefined;
    (row ?? document.querySelector<HTMLElement>(".timeline-checks-chip") ?? listScrollRef.current)?.focus();
  });
  // Today's "N to check today" links here with `check=first`: the first "?" opens once the day's rows are in
  // (location v4 step 14), once per visit.
  const checkParam = searchParams.get("check");
  const openFirstCheck = checkParam === "first";
  // The badge and the chip link to one "?" by its id (owner concern 4); it opens once its row is in.
  const linkedCheckRow = checkParam && !openFirstCheck ? checkRows.find((row) => checkOf(row)?.id === checkParam) : undefined;
  const openedFromLink = useRef<string | null>(null);
  // A link can open its "?" before that day's places are read: it opens under its own row then. When the place or
  // trip arrives and the question is still open, its dialog opens in its place, once (Codex r1 on #609).
  const linkedOpen = useRef<{ id: string; dialog: boolean; seen?: boolean } | null>(null);
  // A link leaving the URL ends that visit: coming back to it on purpose opens its "?" again, while a refresh
  // with the link still there never does (Codex r2 on #609).
  useEffect(() => {
    if (checkParam) return;
    openedFromLink.current = null;
    linkedOpen.current = null;
  }, [checkParam]);
  useEffect(() => {
    if (!checkParam || openedFromLink.current === checkParam || !checkRows.length) return;
    if (!openFirstCheck && !linkedCheckRow) return;
    const frame = requestAnimationFrame(() => {
      openedFromLink.current = checkParam;
      // Its "?" takes focus once the opened row is listed (Codex r1 on #572).
      const opened = linkedCheckRow ? openCheckRow(linkedCheckRow) : nextCheck();
      if (opened) {
        pendingFocus.current = undefined;
        pendingRestore.current = opened;
        const row = checkRows.find((other) => checkOf(other)?.id === opened);
        linkedOpen.current = row ? { id: opened, dialog: opensDialog(row) } : null;
      }
    });
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => {
    const linked = linkedOpen.current;
    if (!linked || linked.dialog) return;
    if (focusedCheck !== linked.id) {
      // Closed, or another "?" opened, once it had opened: nothing to bring back.
      if (linked.seen) linkedOpen.current = null;
      return;
    }
    linked.seen = true;
    const row = checkRows.find((other) => checkOf(other)?.id === linked.id);
    if (!row || !opensDialog(row)) return;
    linkedOpen.current = { id: linked.id, dialog: true };
    openCheckRow(row);
  });
  useEffect(() => {
    const pending = correctionFocus.current;
    if (correction || !pending) return;
    if (!pending.saved) {
      correctionFocus.current = null;
      return;
    }
    const frame = requestAnimationFrame(() => {
      correctionFocus.current = null;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const next = pending.nextKey ? [...document.querySelectorAll<HTMLElement>("[data-check-key]")].find((element) => element.dataset.checkKey === pending.nextKey) : null;
      (next ?? document.querySelector<HTMLElement>(".timeline-checks-chip") ?? listScrollRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [correction]);
  const toggleTripLegs = (entryId: string) => setExpandedTrips((current) => {
    const next = new Set(current);
    if (next.has(entryId)) next.delete(entryId);
    else next.add(entryId);
    return next;
  });

  useEffect(() => {
    inlineEditorRef.current = inlineEditor;
  }, [inlineEditor]);

  const displayedEntries = useMemo(() => {
    if (!optimisticDescriptions.size) return listEntries;
    return listEntries.map((entry) => {
      const optimistic = optimisticDescriptions.get(entry.id);
      return optimistic &&
        entry.description === optimistic.sourceDescription &&
        entry.updatedAt === optimistic.sourceUpdatedAt
        ? { ...entry, description: optimistic.description }
        : entry;
    });
  }, [listEntries, optimisticDescriptions]);

  const overlapAnalysis = useMemo(
    () => analyzeTimeIntervals(
      displayedEntries.map((entry) => ({
        id: entry.id,
        startedAt: entry.startedAt,
        stoppedAt: entry.stoppedAt
      })),
      {
        ...(displayRange ? { range: displayRange } : {}),
        now: capturedNow
      }
    ),
    [capturedNow, displayRange, displayedEntries]
  );
  const overlapById = useMemo(
    () => new Map(overlapAnalysis.entries.map((entry) => [entry.id, entry])),
    [overlapAnalysis.entries]
  );
  const grouped = useMemo(() => {
    return groupTimelineEntriesByDay(
      displayedEntries,
      (entry) => formatDate(timelineEntryDisplayInterval(entry, displayRange, capturedNow).startedAt)
    ).map((group) => ({
      ...group,
      key: `${group.day}:${group.key}`,
      totalSeconds: group.entries.reduce(
        (sum, entry) => sum + intervalSeconds(timelineEntryDisplayInterval(entry, displayRange, capturedNow), capturedNow),
        0
      )
    }));
  }, [capturedNow, displayRange, displayedEntries]);
  // Location rows go before the first group that started before them (newest first, like the blocks).
  // An expanded group lists its occurrences under its heading: a row that falls among them goes before
  // the first occurrence that started before it, so the expanded run stays in time order (Codex r1 on #565).
  // Rows stay inside their own day (Codex r1 on #584): a row on a day with blocks goes among that day's
  // groups (after its last group when it is earlier than all of them); a row on a day without blocks
  // goes under that day's own heading (see extraDays).
  const locationRowsByGroup = useMemo(() => {
    const before: DayLocationRow[][] = grouped.map(() => []);
    const dayTail = new Map<number, DayLocationRow[]>();
    const byOccurrence = new Map<string, DayLocationRow[]>();
    const byExtraDay = new Map<string, DayLocationRow[]>();
    for (const row of locationRows) {
      const dayGroups = grouped.map((group, index) => ({ group, index })).filter(({ group }) => group.day === row.dayLabel);
      if (!dayGroups.length) {
        byExtraDay.set(row.dayLabel, [...(byExtraDay.get(row.dayLabel) ?? []), row]);
        continue;
      }
      const expanded = dayGroups.map(({ group }) => group).find((group) => group.entries.length > 1 &&
        (expandedGroups.has(group.key) || group.entries.some((occurrence) => occurrence.id === highlightedEntryId)) &&
        row.atMs < Date.parse(group.representative.startedAt) &&
        group.entries.some((occurrence) => row.atMs >= Date.parse(occurrence.startedAt)));
      const occurrence = expanded?.entries.find((candidate) => row.atMs >= Date.parse(candidate.startedAt));
      if (occurrence) {
        byOccurrence.set(occurrence.id, [...(byOccurrence.get(occurrence.id) ?? []), row]);
        continue;
      }
      const placed = dayGroups.find(({ group }) => row.atMs >= Date.parse(group.representative.startedAt));
      if (placed) {
        before[placed.index].push(row);
      } else {
        const last = dayGroups[dayGroups.length - 1].index;
        dayTail.set(last, [...(dayTail.get(last) ?? []), row]);
      }
    }
    return { before, byExtraDay, byOccurrence, dayTail };
  }, [expandedGroups, grouped, highlightedEntryId, locationRows]);
  // Each day heading carries that day's time: every block's shown interval clipped to the local day
  // (an overnight block counts on both days; a running one up to the captured time).
  const dayTotals = useMemo(
    () => listDayTotals(displayedEntries.map((entry) => timelineEntryDisplayInterval(entry, displayRange, capturedNow)), capturedNow, formatDate),
    [capturedNow, displayRange, displayedEntries]
  );
  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  // Days without a group of their own still get a heading, in date order (newest first): days that only
  // continue a block started earlier (overnight, or still running) with their total, and days that only
  // have places or checks, with those rows under it (Codex r1 on #584).
  const extraDays = useMemo((): ExtraListDay[] => {
    const groupDays = new Set(grouped.map((group) => group.day));
    const days = new Map<string, ExtraListDay>();
    for (const [label, total] of dayTotals) {
      if (!groupDays.has(label)) days.set(label, { label, dayStartMs: total.dayStartMs, seconds: total.seconds, continued: true, rows: [] });
    }
    for (const [label, rows] of locationRowsByGroup.byExtraDay) {
      const day = days.get(label) ?? { label, dayStartMs: rows[0].dayStartMs, seconds: 0, continued: false, rows: [] };
      days.set(label, { ...day, rows });
    }
    return [...days.values()].sort((left, right) => right.dayStartMs - left.dayStartMs);
  }, [dayTotals, grouped, locationRowsByGroup.byExtraDay]);

  useEffect(() => {
    if (!highlightedEntryId) return;
    const frame = window.requestAnimationFrame(() => {
      const container = listScrollRef.current;
      const target = document.getElementById(`timeline-entry-${highlightedEntryId}`);
      if (!container || !target) return;
      const containerBounds = container.getBoundingClientRect();
      const targetBounds = target.getBoundingClientRect();
      container.scrollTo({
        top: container.scrollTop + targetBounds.top - containerBounds.top - container.clientHeight / 2 + targetBounds.height / 2,
        behavior: "auto"
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [grouped, highlightedEntryId]);

  async function continueEntry(entry: TimeEntryRow, surface: "row" | "editor" = "row") {
    if (continuingEntryId || isTimerBusy) {
      const outcome = { ok: false, error: "A block update is already in progress." } as const;
      if (surface === "row") setActionError(outcome.error);
      return outcome;
    }

    setContinuingEntryId(entry.id);
    setActionError(null);
    try {
      const outcome = await startEntryAgain(entry);
      if (!outcome.ok) {
        clearTimerError();
        if (surface === "row") setActionError(outcome.error);
      }
      return outcome;
    } catch (error) {
      const outcome = {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to start this block."
      } as const;
      if (surface === "row") setActionError(outcome.error);
      return outcome;
    } finally {
      setContinuingEntryId(null);
    }
  }

  function beginInlineEdit(
    entry: TimeEntryRow,
    field: TimelineInlineEditField,
    displayInterval?: { startedAt: string; stoppedAt: string | null },
    target: TimelineInlineEditTarget = {
      day: null,
      entryIds: [entry.id],
      groupKey: null,
      kind: "entry"
    }
  ) {
    const current = inlineEditorRef.current;
    if (current?.entryId === entry.id && current.field === field) return;
    if (isPending || current?.isSaving || (isTimerBusy && !entry.stoppedAt)) return;
    const next: TimelineInlineEditorState = {
      ...createTimelineInlineEditDraft(entry, field, displayInterval),
      entryId: entry.id,
      error: null,
      isSaving: false,
      sessionId: ++inlineSessionRef.current,
      target
    };
    inlineEditorRef.current = next;
    setInlineEditor(next);
    setActionError(null);
    setInlineStatus(null);
  }

  function cancelInlineEdit(entryId: string) {
    if (inlineEditorRef.current?.entryId !== entryId) return;
    setOpenInlineDatePickerKey(null);
    inlineEditorRef.current = null;
    setInlineEditor(null);
  }

  function openFullEditor(entry: TimeEntryRow) {
    setOpenInlineDatePickerKey(null);
    inlineEditorRef.current = null;
    setInlineEditor(null);
    setEditingEntry(entry);
  }

  function updateInlineDescription(entryId: string, description: string) {
    setInlineEditor((current) => {
      if (!current || current.entryId !== entryId || current.field !== "description" || current.isSaving) {
        return current;
      }
      const updated = updateTimelineInlineDescription(current, description);
      const next: TimelineInlineEditorState = {
        ...current,
        ...updated,
        error: null
      };
      inlineEditorRef.current = next;
      return next;
    });
  }

  function updateInlineTime(entry: TimeEntryRow, edge: TimelineInlineTimeEdge, value: string) {
    setInlineEditor((current) => {
      if (!current || current.entryId !== entry.id || current.field !== "time" || current.isSaving) {
        return current;
      }
      const updated = updateTimelineInlineTime(current, entry, edge, value);
      const next: TimelineInlineEditorState = {
        ...current,
        ...updated,
        error: null
      };
      inlineEditorRef.current = next;
      return next;
    });
  }

  function updateInlineDate(entry: TimeEntryRow, edge: TimelineInlineTimeEdge, value: string) {
    setInlineEditor((current) => {
      if (!current || current.entryId !== entry.id || current.field !== "time" || current.isSaving) {
        return current;
      }
      const updated = updateTimelineInlineDate(current, entry, edge, value);
      const next: TimelineInlineEditorState = {
        ...current,
        ...updated,
        error: null
      };
      inlineEditorRef.current = next;
      return next;
    });
  }

  async function commitInlineEdit(entry: TimeEntryRow, returnFocus?: HTMLElement | null) {
    const current = inlineEditorRef.current;
    if (!current || current.entryId !== entry.id || current.isSaving) return;

    let plan;
    try {
      plan = buildTimelineInlineSavePlan(current, entry, capturedNow);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Check the time values.";
      const next = { ...current, error: message };
      inlineEditorRef.current = next;
      setInlineEditor(next);
      window.requestAnimationFrame(() => returnFocus?.focus({ preventScroll: true }));
      return;
    }

    if (!Object.keys(plan.payload).length) {
      cancelInlineEdit(entry.id);
      return;
    }

    const saving = { ...current, error: null, isSaving: true };
    inlineEditorRef.current = saving;
    setInlineEditor(saving);
    const groupedDescription = current.target.kind === "group";
    const nextDescription = plan.payload.description ?? null;
    const outcome = groupedDescription
      ? await saveGroupedTimeEntryDescription(current.target.entryIds, nextDescription)
      : entry.stoppedAt
        ? await saveTimeEntryQuickEdit(entry.id, plan)
        : await updateActiveEntryFromCalendar({ plan });
    const latest = inlineEditorRef.current;

    if (!outcome.ok) {
      if (latest?.sessionId !== current.sessionId) {
        setActionError(outcome.error);
        return;
      }
      const failed = { ...saving, error: outcome.error, isSaving: false };
      inlineEditorRef.current = failed;
      setInlineEditor(failed);
      window.requestAnimationFrame(() => returnFocus?.focus({ preventScroll: true }));
      return;
    }

    if (latest?.sessionId === current.sessionId && groupedDescription) {
      const nextGroupKey = current.target.day
        ? `${current.target.day}:${timelineEntryGroupKey({ ...entry, description: nextDescription })}`
        : null;
      inlineEditorRef.current = null;
      applyTimelineRegroup(() => {
        setInlineEditor(null);
        setOptimisticDescriptions((descriptions) => {
          const next = new Map(descriptions);
          for (const entryId of current.target.entryIds) {
            const source = entries.find((candidate) => candidate.id === entryId);
            if (!source) continue;
            next.set(entryId, {
              description: nextDescription,
              sourceDescription: source.description,
              sourceUpdatedAt: source.updatedAt
            });
          }
          return next;
        });
        if (current.target.groupKey && nextGroupKey) {
          setExpandedGroups((expanded) => {
            const next = new Set(expanded);
            const preserveExpansion = next.delete(current.target.groupKey!);
            if (preserveExpansion) next.add(nextGroupKey);
            return next;
          });
        }
      });
      setInlineStatus(`Updated ${current.target.entryIds.length} grouped blocks.`);
      await onChanged?.();
      if (nextGroupKey) focusGroupedDescription(nextGroupKey);
      startTransition(() => router.refresh());
      return;
    }

    if (latest?.sessionId === current.sessionId) {
      inlineEditorRef.current = null;
      setInlineEditor(null);
    }
    await onChanged?.();
    startTransition(() => router.refresh());
  }

  function focusGroupedDescription(groupKey: string) {
    window.requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLTableRowElement>("[data-timeline-group-key]"))
        .find((candidate) => candidate.dataset.timelineGroupKey === groupKey);
      row?.querySelector<HTMLInputElement>(".timeline-inline-description-input")
        ?.focus({ preventScroll: true });
    });
  }

  function handleInlineKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    entry: TimeEntryRow,
    field: TimelineInlineEditField,
    displayInterval?: { startedAt: string; stoppedAt: string | null },
    target?: TimelineInlineEditTarget
  ) {
    const active = inlineEditorRef.current?.entryId === entry.id && inlineEditorRef.current.field === field;
    if (!active && (event.key === "Enter" || event.key === "F2")) {
      event.preventDefault();
      beginInlineEdit(entry, field, displayInterval, target);
      return;
    }
    if (!active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelInlineEdit(entry.id);
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void commitInlineEdit(entry, event.currentTarget);
    }
  }

  function renderInlineDescription(entry: TimeEntryRow, target?: TimelineInlineEditTarget) {
    const editTarget = target ?? {
      day: null,
      entryIds: [entry.id],
      groupKey: null,
      kind: "entry" as const
    };
    const isGroupedTarget = editTarget.kind === "group";
    const editor = inlineEditor?.entryId === entry.id && inlineEditor.field === "description"
      ? inlineEditor
      : null;
    const value = editor ? editor.draft.description : timeEntryTitle(entry);
    return (
      <span
        className={`timeline-inline-description${editor ? " is-editing" : ""}`}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (isGroupedTarget) {
            if (!editor) beginInlineEdit(entry, "description", undefined, editTarget);
          } else {
            openFullEditor(entry);
          }
        }}
      >
        <span aria-hidden="true" className="timeline-inline-description-measure timeline-task-title">
          {value || "Untitled block"}
        </span>
        <input
          aria-label={isGroupedTarget
            ? `${timeEntryTitle(entry)} shared description for ${editTarget.entryIds.length} grouped blocks. Click to edit all occurrences.`
            : `${timeEntryTitle(entry)} description. Click to edit inline. Double-click to open the full editor.`}
          className="timeline-task-title timeline-inline-description-input"
          data-inline-edit-scope={editTarget.kind}
          data-inline-entry-id={entry.id}
          data-inline-field="description"
          onBlur={(event) => {
            if (editor) void commitInlineEdit(entry, event.currentTarget);
          }}
          onChange={(event) => updateInlineDescription(entry.id, event.target.value)}
          onClick={() => {
            if (!editor) beginInlineEdit(entry, "description", undefined, editTarget);
          }}
          onKeyDown={(event) => {
            handleInlineKeyDown(event, entry, "description", undefined, editTarget);
          }}
          placeholder="Untitled block"
          readOnly={!editor || editor.isSaving}
          data-tip={isGroupedTarget ? `Click to edit all ${editTarget.entryIds.length} occurrences.` : "Click to edit. Double-click for the full editor."}
          value={value}
        />
      </span>
    );
  }

  function renderInlineTime(
    entry: TimeEntryRow,
    interval: { startedAt: string; stoppedAt: string | null }
  ) {
    const editor = inlineEditor?.entryId === entry.id && inlineEditor.field === "time"
      ? inlineEditor
      : null;
    const handleBlur = (event: ReactFocusEvent<HTMLSpanElement>) => {
      if (!editor || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      if (openInlineDatePickerKey?.startsWith(`${entry.id}:`)) return;
      const returnFocus = event.currentTarget.querySelector<HTMLInputElement>("input");
      void commitInlineEdit(entry, returnFocus);
    };
    const timeInput = (edge: TimelineInlineTimeEdge, instant: string) => {
      const typedValue = editor ? edge === "start" ? editor.draft.startedAtTime : editor.draft.stoppedAtTime : null;
      const value = typedValue !== null ? displayTypedTime(typedValue, clock) : formatTime(instant, clock);
      const date = editor
        ? edge === "start" ? editor.draft.startedAtDate : editor.draft.stoppedAtDate
        : dateTimeLocal(instant).slice(0, 10);
      const pickerKey = `${entry.id}:${edge}`;
      return (
        <TimelineInlineTimeControl
          date={date}
          disabled={editor?.isSaving}
          edge={edge}
          entryId={entry.id}
          entryTitle={timeEntryTitle(entry)}
          onBeginEdit={() => {
            if (!editor) beginInlineEdit(entry, "time", interval);
          }}
          onDateChange={(nextDate) => updateInlineDate(entry, edge, nextDate)}
          onKeyDown={(event) => handleInlineKeyDown(event, entry, "time", interval)}
          onPickerOpenChange={(open) => {
            if (open) {
              setOpenInlineDatePickerKey(pickerKey);
              if (!editor) beginInlineEdit(entry, "time", interval);
            } else if (openInlineDatePickerKey === pickerKey) {
              setOpenInlineDatePickerKey(null);
            }
          }}
          onTimeChange={(nextTime) => updateInlineTime(entry, edge, nextTime)}
          readOnly={!editor || editor.isSaving}
          today={dateTimeLocal(capturedNow).slice(0, 10)}
          typedValue={typedValue}
          value={value}
        />
      );
    };
    return (
      <span
        className={`timeline-inline-time${editor ? " is-editing" : ""}${interval.stoppedAt ? "" : " is-running"}`}
        data-clock={clock}
        onBlur={handleBlur}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openFullEditor(entry);
        }}
        data-tip="Click to edit. Double-click for the full editor."
      >
        {timeInput("start", interval.startedAt)}
        <span aria-hidden="true" className="timeline-inline-time-separator">
          <Minus size={12} strokeWidth={1.5} />
        </span>
        {interval.stoppedAt
          ? timeInput("finish", interval.stoppedAt)
          : <span className="timeline-inline-running">Running</span>}
      </span>
    );
  }

  function renderInlineStatus(entry: TimeEntryRow) {
    const editor = inlineEditor?.entryId === entry.id ? inlineEditor : null;
    if (editor?.error) return <span className="timeline-inline-edit-error" role="alert">{editor.error}</span>;
    if (editor?.isSaving) {
      return <span className="sr-only" role="status">{editor.target.kind === "group" ? "Saving grouped blocks" : "Saving block"}</span>;
    }
    return null;
  }

  function renderDuration(entry: TimeEntryRow, fallbackSeconds: number) {
    const editor = inlineEditor?.entryId === entry.id && inlineEditor.field === "time"
      ? inlineEditor
      : null;
    return formatDuration(editor?.draft.durationSeconds ?? fallbackSeconds);
  }

  return (
    <section className="timeline-list-workspace">
      {actionError ? (
        <ErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}
      {inlineStatus ? <p className="sr-only" aria-live="polite" role="status">{inlineStatus}</p> : null}

      <div className={`timeline-list-body${columnShown ? " has-places-column" : ""}`}>
      <div
        aria-busy={localTimeReady && !continuousLoading ? undefined : true}
        className="timeline-list-scroll"
        onFocus={(event) => {
          // Which suggestion's "?" holds focus, so it keeps it when its row is replaced (Codex r2 on #572).
          const key = (event.target as HTMLElement).dataset.checkKey;
          const row = key ? checkRows.find((other) => other.key === key) : undefined;
          focusedToggleItem.current = row ? checkOf(row)?.id ?? null : null;
        }}
        data-continuous={continuous ? "true" : undefined}
        onKeyDown={endFocusOnUserScroll}
        onPointerDown={endFocusOnUserScroll}
        onTouchStart={endFocusOnUserScroll}
        onWheel={endFocusOnUserScroll}
        onScroll={(event) => {
          if (continuous && anchorFrameRef.current === null) {
            anchorFrameRef.current = requestAnimationFrame(() => {
              anchorFrameRef.current = null;
              recordScrollAnchor();
              if (columnShown) trackColumnDay();
            });
          }
          onScroll(event);
        }}
        // Focus can land on the List itself when no "?" or chip is left to take it.
        tabIndex={-1}
        ref={(element) => {
          listScrollRef.current = element;
          scrollContainerRef(element);
        }}
      >
        {localTimeReady ? <ChecksChip count={askingOrder.length} onNext={nextCheck} /> : null}
        {/* Owner item H: a quiet filter at the top of the List, not a filled pill under it. */}
        {localTimeReady && !columnShown && dayTimelines.some((timeline) => hasLocationPlaces(timeline)) ? (
          <div className="timeline-places-filter">
            <button aria-pressed={showEveryPlace} onClick={() => setShowEveryPlace((current) => !current)} type="button">
              {showEveryPlace ? "Fewer places" : "All places"}
            </button>
            {wide ? <button onClick={() => setPlacesColumn(true)} type="button">Places beside the List</button> : null}
          </div>
        ) : null}
        {continuous && localTimeReady ? (
          <ContinuousEdge direction="later" error={continuousError === "later"} loading={continuousLoading === "later"}
            onRetry={() => continuous.onLoad("later")} reachedEnd={continuous.reachedLatest} sentinelRef={laterSentinelRef} />
        ) : null}
        <table className="timeline-list-table" data-clock={clock}>
          {/* Column names stay for screen readers; the rows read as Blocks rows (as on Today). */}
          {/* Column widths live here: the header row is visually hidden, so it can't size the columns. */}
          <colgroup>
            <col className="timeline-list-col-block" />
            <col className="timeline-list-col-time" />
            <col className="timeline-list-col-duration" />
            <col className="timeline-list-col-actions" />
          </colgroup>
          <thead className="timeline-list-head">
            <tr>
              <th>Block</th>
              <th>Time</th>
              <th>Duration</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* eslint-disable-next-line react-hooks/refs -- nested row callbacks read refs only after user interaction */}
            {grouped.map((group, index) => {
              const entry = group.representative;
              const displayInterval = timelineEntryDisplayInterval(entry, displayRange, capturedNow);
              const previousDate = index > 0 ? grouped[index - 1].day : null;
              const shouldShowDate = groupByDay && group.day !== previousDate;
              const isGrouped = group.entries.length > 1;
              const isExpanded = isGrouped && (
                expandedGroups.has(group.key) ||
                group.entries.some((occurrence) => occurrence.id === highlightedEntryId)
              );
              const overlappingOccurrences = group.entries.filter(
                (occurrence) => (overlapById.get(occurrence.id)?.overlapCount ?? 0) > 0
              );
              const groupEditTarget: TimelineInlineEditTarget | undefined = isGrouped
                ? {
                    day: group.day,
                    entryIds: group.entries.map((occurrence) => occurrence.id),
                    groupKey: group.key,
                    kind: "group"
                  }
                : undefined;
              return (
                <Fragment key={group.key}>
                  {shouldShowDate
                    ? extraDays
                      .filter((day) => day.dayStartMs > (dayTotals.get(group.day)?.dayStartMs ?? 0) &&
                        (previousDate === null || day.dayStartMs < (dayTotals.get(previousDate)?.dayStartMs ?? Infinity)))
                      .map((day) => <ExtraDayRows day={day} key={`extra-${day.label}`} renderRow={renderLocationRow} />)
                    : null}
                  {shouldShowDate ? (
                    <tr key={`${group.day}-${entry.id}-group`} className="timeline-list-day-heading"
                      data-day-start-ms={dayTotals.get(group.day)?.dayStartMs}>
                      <td colSpan={4}>
                        <span>{group.day}</span>
                        <span className="tabular">{formatDuration(dayTotals.get(group.day)?.seconds ?? 0)}</span>
                      </td>
                    </tr>
                  ) : null}
                  {locationRowsByGroup.before[index].map((row) => (
                    renderLocationRow(row)
                  ))}
                <tr
                  className={[
                    "motion-row timeline-list-row align-middle",
                    highlightedEntryId === entry.id && !isGrouped ? "timeline-entry-highlight" : ""
                  ].join(" ")}
                  data-timeline-group-key={group.key}
                  id={!isGrouped ? `timeline-entry-${entry.id}` : undefined}
                >
                  <td className="px-3 py-3 font-medium">
                    <div className={`timeline-task-cell${isGrouped ? "" : " is-single"}`}>
                      {isGrouped ? (
                        <button
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.entries.length} ${timeEntryTitle(entry)} blocks`}
                          className="timeline-group-count"
                          onClick={() => setExpandedGroups((current) => {
                            const next = new Set(current);
                            if (next.has(group.key)) next.delete(group.key);
                            else next.add(group.key);
                            return next;
                          })}
                          type="button"
                        >
                          {group.entries.length}
                        </button>
                      ) : null}
                      {/* A grouped row's mark follows the length it shows (the group's total; Codex r2 on #583). */}
                      <ListBlockMark category={entry.categoryId ? categoriesById.get(entry.categoryId) ?? null : null} entry={entry}
                        seconds={isGrouped ? group.totalSeconds : intervalSeconds(displayInterval, capturedNow)} />
                      <span className="timeline-task-details">
                        <span className="timeline-task-primary-line">
                          {renderInlineDescription(entry, groupEditTarget)}
                        </span>
                        {/* Calendar v3 (owner choice A): the place (pin, or a trip's route) or the tags, with its icon. */}
                        <ListSecondaryLine entry={entry} />
                        {!isGrouped && tripByBlock.get(entry.id) ? (
                          <TripModesLine legs={tripByBlock.get(entry.id)!.legs} route={tripByBlock.get(entry.id)!.route} />
                        ) : null}
                        {renderInlineStatus(entry)}
                        {overlappingOccurrences.length > 0 ? (
                          <span
                            className="overlap-marker"
                            aria-label={isGrouped
                              ? `${overlappingOccurrences.length} blocks in this group overlap other blocks`
                              : overlapMarkerDescription(entry, overlapById.get(entry.id), displayedEntries, clock)}
                            data-tip={isGrouped
                              ? `${overlappingOccurrences.length} blocks in this group overlap other blocks`
                              : overlapMarkerDescription(entry, overlapById.get(entry.id), displayedEntries, clock)}
                          >
                            {isGrouped
                              ? `${overlappingOccurrences.length} overlapping`
                              : `Overlap · ${formatDuration(overlapById.get(entry.id)?.overlapSeconds ?? 0)}`}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </td>
                  <td className="tabular px-3 py-3">
                    <div className="timeline-list-time-content">
                      {isGrouped
                        ? (
                          <span
                            className="timeline-group-time-summary"
                            onDoubleClick={() => openFullEditor(entry)}
                            data-tip="Double-click to edit the latest occurrence"
                          >
                            {group.entries.length} occurrences
                          </span>
                        )
                        : renderInlineTime(entry, displayInterval)}
                    </div>
                  </td>
                  <td className="tabular px-3 py-3 timeline-list-duration">
                    <div className="timeline-list-duration-content">
                      {isGrouped ? formatDuration(group.totalSeconds) : renderDuration(entry, group.totalSeconds)}
                      {!isGrouped && tripByBlock.get(entry.id) ? (
                        <TripLegsToggle
                          expanded={expandedTrips.has(entry.id)}
                          onToggle={() => toggleTripLegs(entry.id)}
                          title={timeEntryTitle(entry)}
                        />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="timeline-list-actions">
                      <button
                        className="df-icon-action"
                        data-tip={entry.stoppedAt ? "Start again" : "Restart"}
                        disabled={isPending || Boolean(continuingEntryId)}
                        aria-label={!entry.stoppedAt
                          ? `Restart ${timeEntryTitle(entry)} from zero`
                          : isGrouped
                            ? `Start ${timeEntryTitle(entry)} from this group again`
                            : `Start ${timeEntryTitle(entry)} again`}
                        onClick={() => continueEntry(entry)}
                        type="button"
                      >
                        {/* #257: Start again is the Play glyph everywhere; Restart (running, from zero) keeps its arrow. */}
                        {entry.stoppedAt ? <DayframeIcon fill="currentColor" glyph="play" size={14} strokeWidth={0} /> : <DayframeIcon glyph="rotate-ccw" size={16} />}
                      </button>
                      <button
                        className="df-icon-action"
                        data-tip="Edit"
                        aria-label={isGrouped ? `Edit the latest ${timeEntryTitle(entry)}` : `Edit ${timeEntryTitle(entry)}`}
                        onClick={() => openFullEditor(entry)}
                        type="button"
                      >
                        <DayframeIcon glyph="pencil" size={16} />
                      </button>
                      <button
                        className="df-icon-action"
                        data-tip="Delete"
                        aria-label={isGrouped
                          ? `Delete all ${group.entries.length} ${timeEntryTitle(entry)} blocks`
                          : `Delete ${timeEntryTitle(entry)}`}
                        onClick={() => onDeleteEntries(isGrouped ? group.entries : [entry])}
                        type="button"
                      >
                        <DayframeIcon glyph="trash-2" size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                {!isGrouped && tripByBlock.get(entry.id)
                  ? <TripLegRows clock={clock} expanded={expandedTrips.has(entry.id)} legs={tripByBlock.get(entry.id)!.legs}
                      onCorrectLeg={correctLeg(tripByBlock.get(entry.id)!.id, tripByBlock.get(entry.id)!.legs)} />
                  : null}
                {isExpanded ? group.entries.map((occurrence) => {
                  const occurrenceInterval = timelineEntryDisplayInterval(occurrence, displayRange, capturedNow);
                  const highlighted = highlightedEntryId === occurrence.id;
                  const occurrenceTrip = tripByBlock.get(occurrence.id);
                  return (
                    <Fragment key={occurrence.id}>
                    {(locationRowsByGroup.byOccurrence.get(occurrence.id) ?? []).map((row) => (
                      renderLocationRow(row)
                    ))}
                    <tr
                      className={`timeline-occurrence-row motion-row timeline-list-row align-middle${highlighted ? " timeline-entry-highlight" : ""}`}
                      id={`timeline-entry-${occurrence.id}`}
                    >
                      <td className="px-3 py-3">
                        <div className="timeline-task-cell timeline-occurrence-task">
                          <ListBlockMark category={occurrence.categoryId ? categoriesById.get(occurrence.categoryId) ?? null : null} entry={occurrence}
                            seconds={intervalSeconds(occurrenceInterval, capturedNow)} />
                          <span className="timeline-task-details">
                            <span className="timeline-task-primary-line">
                              {renderInlineDescription(occurrence)}
                            </span>
                            <ListSecondaryLine entry={occurrence} />
                            {occurrenceTrip ? <TripModesLine legs={occurrenceTrip.legs} route={occurrenceTrip.route} /> : null}
                            {renderInlineStatus(occurrence)}
                            {(overlapById.get(occurrence.id)?.overlapCount ?? 0) > 0 ? (
                              <span
                                className="overlap-marker"
                                aria-label={overlapMarkerDescription(
                                  occurrence,
                                  overlapById.get(occurrence.id),
                                  displayedEntries,
                                  clock
                                )}
                                data-tip={overlapMarkerDescription(
                                  occurrence,
                                  overlapById.get(occurrence.id),
                                  displayedEntries,
                                  clock
                                )}
                              >
                                Overlap · {formatDuration(overlapById.get(occurrence.id)?.overlapSeconds ?? 0)}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      </td>
                      <td className="tabular px-3 py-3">
                        <div className="timeline-list-time-content">
                          {renderInlineTime(occurrence, occurrenceInterval)}
                        </div>
                      </td>
                      <td className="tabular px-3 py-3 timeline-list-duration">
                        <div className="timeline-list-duration-content">
                          {renderDuration(occurrence, intervalSeconds(occurrenceInterval, capturedNow))}
                          {occurrenceTrip ? (
                            <TripLegsToggle
                              expanded={expandedTrips.has(occurrence.id)}
                              onToggle={() => toggleTripLegs(occurrence.id)}
                              title={timeEntryTitle(occurrence)}
                            />
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="timeline-list-actions">
                          <button
                            className="df-icon-action"
                            data-tip="Edit"
                            aria-label={`Edit this ${timeEntryTitle(occurrence)}`}
                            onClick={() => openFullEditor(occurrence)}
                            type="button"
                          >
                            <DayframeIcon glyph="pencil" size={16} />
                          </button>
                          <button
                            className="df-icon-action"
                            data-tip="Delete"
                            aria-label={`Delete this ${timeEntryTitle(occurrence)}`}
                            onClick={() => onDeleteEntries([occurrence])}
                            type="button"
                          >
                            <DayframeIcon glyph="trash-2" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {occurrenceTrip
                      ? <TripLegRows clock={clock} expanded={expandedTrips.has(occurrence.id)} legs={occurrenceTrip.legs}
                          onCorrectLeg={correctLeg(occurrenceTrip.id, occurrenceTrip.legs)} />
                      : null}
                    </Fragment>
                  );
                }) : null}
                {(locationRowsByGroup.dayTail.get(index) ?? []).map((row) => renderLocationRow(row))}
                </Fragment>
              );
            })}
            {groupByDay
              ? extraDays
                .filter((day) => !grouped.length || day.dayStartMs < (dayTotals.get(grouped[grouped.length - 1].day)?.dayStartMs ?? -Infinity))
                .map((day) => <ExtraDayRows day={day} key={`extra-${day.label}`} renderRow={renderLocationRow} />)
              : extraDays.flatMap((day) => day.rows).map((row) => renderLocationRow(row))}
          </tbody>
        </table>
        {continuous && localTimeReady ? (
          <ContinuousEdge direction="earlier" error={continuousError === "earlier"} loading={continuousLoading === "earlier"}
            onRetry={() => continuous.onLoad("earlier")} reachedEnd={continuous.reachedEarliest} sentinelRef={earlierSentinelRef} />
        ) : null}
        {listChecks.state.error ? <ErrorBanner message={listChecks.state.error} onDismiss={listChecks.clearError} /> : null}
        {listChecks.state.notice ? (
          <BlocksToast actionLabel="Undo" exiting={listChecks.state.notice.isExiting} key={listChecks.state.notice.token}
            message={listChecks.state.notice.label} onAction={listChecks.undo}
            swatchStyle={listChecks.state.notice.color ? blockStyle(listChecks.state.notice.color, listChecks.state.notice.colorName) : undefined} />
        ) : null}
      </div>
      {columnShown ? (() => {
        const dayStart = columnDayStartMs ?? continuous?.focusDayStartMs ?? (dayTimelines[0] ? Date.parse(dayTimelines[0].dayStart) : null);
        const timeline = dayTimelines.find((candidate) => Date.parse(candidate.dayStart) === dayStart) ?? null;
        const askingBySegment = new Map(shownChecks.flatMap((check) => check.segmentId ? [[check.segmentId, check.id] as const] : []));
        return (
          <PlacesColumn askingBySegment={askingBySegment} blocks={entries} clock={clock} nowMs={nowMs}
            onCorrectLeg={(trip, index) => correctLeg(trip.id, trip.legs)(index)} onCorrectPlace={correctPlace}
            onCorrectTrip={(trip, route) => openCorrection({ kind: "trip", trip, route })}
            onHide={() => setPlacesColumn(false)}
            onOpenCheck={(checkId) => {
              const row = checkRows.find((other) => checkOf(other)?.id === checkId);
              if (row) openCheckRow(row);
            }}
            timeline={timeline} />
        );
      })() : null}
      </div>
      {correction ? (
        <LocationCorrectionDialog activities={categories} clock={clock} onClose={() => { setCorrection(null); setCorrectionCheckId(null); }}
          // Held for Undo like an inline answer; focus then moves on. "Logs as" is log_place, which closes the "?" itself.
          question={dialogCheck && dialogWords ? { text: dialogWords.question, yesLabel: dialogWords.yesLabel, noLabel: "Not now",
            onAnswer: (yes: boolean) => answerFromDialog(dialogCheck.id, yes) } : null}
          onCorrected={async () => {
            if (correctionFocus.current) correctionFocus.current.saved = true;
            await onChanged?.();
          }} places={places} target={correction} />
      ) : null}
      {editingEntry ? (
        <TimeEntryQuickEditorModal
          capturedNow={capturedNow}
          categories={categories}
          entry={editingEntry}
          isTimerBusy={isTimerBusy}
          onClose={() => setEditingEntry(null)}
          onCreateCategory={createCategory}
          onDelete={() => {
            const entry = editingEntry;
            setEditingEntry(null);
            onDeleteEntries([entry]);
          }}
          onSave={async (plan) => {
            const outcome = editingEntry.stoppedAt
              ? await saveTimeEntryQuickEdit(editingEntry.id, plan)
              : await updateActiveEntryFromCalendar({ plan });
            if (outcome.ok) {
              await onChanged?.();
              startTransition(() => router.refresh());
            }
            return outcome;
          }}
          onStartAgain={editingEntry.stoppedAt ? () => continueEntry(editingEntry, "editor") : undefined}
          onSplit={async (atMs) => {
            const outcome = await splitTimeEntry(clientFetch, editingEntry, atMs);
            // A failure that may have changed the day (changed elsewhere, or unknown) shows it again too.
            if (outcome.ok || outcome.changed) {
              await onChanged?.();
              startTransition(() => router.refresh());
            }
            return outcome;
          }}
          onDuplicate={async () => {
            const outcome = await duplicateTimeEntry(clientFetch, editingEntry);
            // A failure that may have changed the day (changed elsewhere, or unknown) shows it again too.
            if (outcome.ok || outcome.changed) {
              await onChanged?.();
              startTransition(() => router.refresh());
            }
            return outcome;
          }}
          peerEntries={entries}
          taskSuggestions={shellData?.taskSuggestions ?? []}
          taskSuggestionCandidates={shellData?.taskSuggestionCandidates}
          tags={tags}
        />
      ) : null}
    </section>
  );
}

function overlapMarkerDescription(
  entry: TimeEntryRow,
  overlap: TimeIntervalAnalysisEntry | undefined,
  entries: ReadonlyArray<TimeEntryRow>,
  clock: ClockFormat
) {
  if (!overlap?.overlapCount) return "No overlap";
  const firstPeer = entries.find((candidate) => overlap.overlappingEntryIds.includes(candidate.id));
  const peerDetail = firstPeer
    ? `, including ${timeEntryTitle(firstPeer)} from ${formatTime(firstPeer.startedAt, clock)} to ${
        firstPeer.stoppedAt ? formatTime(firstPeer.stoppedAt, clock) : "now"
      }`
    : "";
  return `Overlap: ${formatDuration(overlap.uniqueOverlapSeconds)} shared with ${overlap.overlapCount} other ${
    overlap.overlapCount === 1 ? "block" : "blocks"
  }${peerDetail}. ${timeEntryTitle(entry)} still counts in full towards Total logged.`;
}

const NO_LIST_ENTRIES: TimeEntryRow[] = [];

export type ListDayTotal = { dayStartMs: number; seconds: number };

/** Time per local day (keyed by the List's day label) across intervals, each clipped to its days. */
export function listDayTotals(
  intervals: ReadonlyArray<{ startedAt: string; stoppedAt: string | null }>,
  capturedNow: Date,
  dayLabel: (iso: string) => string
) {
  const totals = new Map<string, ListDayTotal>();
  for (const interval of intervals) {
    const start = Date.parse(interval.startedAt);
    const end = interval.stoppedAt ? Date.parse(interval.stoppedAt) : capturedNow.getTime();
    if (!(end > start)) continue;
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() < end) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      const from = Math.max(start, cursor.getTime());
      const to = Math.min(end, next.getTime());
      if (to > from) {
        const key = dayLabel(new Date(from).toISOString());
        const current = totals.get(key) ?? { dayStartMs: cursor.getTime(), seconds: 0 };
        current.seconds += Math.floor((to - from) / 1000);
        totals.set(key, current);
      }
      cursor.setTime(next.getTime());
    }
  }
  return totals;
}

/** A selector that finds a List row again after React remounts it, or null for a row without an identity. */
function listRowSelector(row: Element) {
  const element = row as HTMLElement;
  const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  if (element.dataset.dayStartMs) return `tr[data-day-start-ms=${quoted(element.dataset.dayStartMs)}]`;
  // An open question, and a "?" row, by their suggestion: both survive a day's places replacing the
  // suggestion's own row with a place row's "?" (Codex r8 on #584).
  if (element.dataset.questionFor) return `tr[data-question-for=${quoted(element.dataset.questionFor)}]`;
  if (element.dataset.suggestionId) return `tr[data-suggestion-id=${quoted(element.dataset.suggestionId)}]`;
  // A place spanning midnight is a row on each day with the same place id: its row key carries the day (Codex r7 on #584).
  if (element.dataset.rowKey) return `tr[data-row-key=${quoted(element.dataset.rowKey)}]`;
  if (element.id) return `tr[id=${quoted(element.id)}]`;
  if (element.dataset.timelineGroupKey) return `tr[data-timeline-group-key=${quoted(element.dataset.timelineGroupKey)}]`;
  if (element.dataset.locationRow) return `tr[data-location-row=${quoted(element.dataset.locationRow)}]`;
  return null;
}

/** A shown day's location row, placed by its time within the day it was read for. */
type DayLocationRow = LocationListRow & { dayLabel: string; dayStartMs: number };

/** A day without a group of its own: one that only continues an earlier block, or only has places or checks. */
type ExtraListDay = { label: string; dayStartMs: number; seconds: number; continued: boolean; rows: DayLocationRow[] };

/**
 * A day without a group of its own: its heading (with its total when a block continues into it, and its
 * start for scrolling to it), a note when it only continues an earlier block, and its places and checks.
 */
function ExtraDayRows({ day, renderRow }: { day: ExtraListDay; renderRow: (row: DayLocationRow) => ReactNode }) {
  return (
    <>
      <tr className="timeline-list-day-heading" data-day-start-ms={day.dayStartMs}>
        <td colSpan={4}>
          <span>{day.label}</span>
          <span className="tabular">{day.continued ? formatDuration(day.seconds) : ""}</span>
        </td>
      </tr>
      {day.continued ? (
        <tr className="timeline-list-continued">
          <td colSpan={4}>Continues from the day before</td>
        </tr>
      ) : null}
      {day.rows.map((row) => renderRow(row))}
    </>
  );
}

/**
 * The activity block with its icon, Today's row mark (Calendar v3, owner choice A: block markers everywhere,
 * never a thin colour bar): 36 px wide, its height following the block's length (`blockRowHeight`), X3
 * corners; no activity is a neutral block.
 */
function ListBlockMark({ category, entry, seconds }: { category: CategoryRow | null; entry: TimeEntryRow; seconds: number }) {
  const glyph = resolveActivityIcon({ icon: category?.icon ?? null, name: entry.categoryName }).glyph;
  return (
    <span
      aria-hidden="true"
      className={`timeline-task-block${entry.categoryId ? " df-block" : ""}`}
      style={{
        ...(entry.categoryId ? blockStyle(entry.categoryColor, entry.categoryName ?? "") : {}),
        height: blockRowHeight(seconds * 1000)
      }}
    >
      <DayframeIcon glyph={entry.categoryId ? glyph : "tag"} size={16} />
    </span>
  );
}

/**
 * A List row's second line (Calendar v3, owner choice A; Apple's layout): the place with a pin (a trip's
 * route for a block a Move logged), else the tags with a tag; neither, no second line (the block mark's
 * colour and icon carry the activity, and the row's name says it).
 */
function ListSecondaryLine({ entry }: { entry: TimeEntryRow }) {
  // Owner item F (28 Oct 2026): a place line that only repeats the title ("PureGym" / "📍 PureGym") is dropped.
  const repeatsTitle = entry.placeName?.trim().toLowerCase() === timeEntryTitle(entry).trim().toLowerCase();
  if (entry.placeName && !repeatsTitle) {
    return (
      <span className="timeline-task-secondary-line">
        <DayframeIcon glyph={entry.automaticMoveEventId ? "route" : "map-pin"} size={12} />
        <span className="timeline-task-meta">{entry.placeName}</span>
      </span>
    );
  }
  if (entry.tagNames.length) {
    return (
      <span className="timeline-task-secondary-line">
        <DayframeIcon glyph="tag" size={12} />
        <TagMetadata compact tagNames={entry.tagNames} />
      </span>
    );
  }
  return null;
}

function intervalSeconds(
  interval: { startedAt: string; stoppedAt: string | null },
  capturedNow: Date
) {
  return Math.max(
    0,
    Math.round(
      ((interval.stoppedAt ? Date.parse(interval.stoppedAt) : capturedNow.getTime()) - Date.parse(interval.startedAt)) / 1000
    )
  );
}

/**
 * One end of Calendar › List's continuous days: an invisible sentinel that loads the next week as it
 * nears the view, and a status line while it loads, if it fails (with Try again) or at the List's start.
 */
function ContinuousEdge({ direction, error, loading, onRetry, reachedEnd, sentinelRef }: {
  direction: "earlier" | "later";
  error: boolean;
  loading: boolean;
  onRetry: () => void;
  reachedEnd: boolean;
  sentinelRef: RefObject<HTMLDivElement | null>;
}) {
  const days = direction === "earlier" ? "earlier" : "later";
  return (
    <div className={`timeline-list-edge is-${direction}`} data-list-edge={direction}>
      {reachedEnd ? null : <div aria-hidden="true" className="timeline-list-sentinel" ref={sentinelRef} />}
      <p aria-live="polite" className="timeline-list-edge-status" role="status">
        {error ? (
          <>
            {`Couldn't load ${days} days.`}
            <button className="timeline-list-edge-retry" onClick={onRetry} type="button">Try again</button>
          </>
        ) : loading ? `Loading ${days} days…` : reachedEnd && direction === "earlier" ? "No earlier blocks." : ""}
      </p>
    </div>
  );
}
