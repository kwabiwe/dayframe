"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_LEG_MODE_ICONS,
  legDetail,
  legModeLabel,
  type ClockFormat,
  type DayframeGlyph,
  type LocationListRow,
  type LocationTimeline,
  type TimelinePlace,
  type TripLeg
} from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { clientFetch } from "@/lib/client-auth-fetch";
import { formatDuration, formatTime } from "@/lib/format";
import { inListRefreshWindow, listRefreshWindow } from "@/lib/timeline-view";

/**
 * The day's location timeline for Calendar › List (location v4 step 10): fetched for the shown day and
 * again whenever `refreshKey` changes (the runtime's bootstrap refresh). Null until it arrives or when it
 * fails; the List then shows blocks only, as before. Kept per owner (workspace and user) and day, so a
 * workspace switch never shows another workspace's places; a replaced or unmounted request is aborted.
 */
export function useLocationTimeline(date: string | null, refreshKey: unknown, owner: string) {
  const [loaded, setLoaded] = useState<{ owner: string; timeline: LocationTimeline } | null>(null);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    clientFetch(`/api/timeline?date=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => (response.ok ? (await response.json()) as LocationTimeline : null))
      .catch(() => null)
      .then((next) => {
        if (controller.signal.aborted) return;
        // A failed refresh keeps the same owner's same day; anything else clears.
        setLoaded((current) => next ? { owner, timeline: next }
          : current?.owner === owner && current.timeline.date === date ? current : null);
      });
    return () => controller.abort();
  }, [date, owner, refreshKey]);
  return date && loaded?.owner === owner && loaded.timeline.date === date ? loaded.timeline : null;
}

/** Of the stale days without places the List's top day passes over, at most this many are read per move (nearest first). */
export const LOCATION_GAP_DAYS_READ_ON_SCROLL = 2;

/** Of the edited blocks' own days outside the window, at most this many are read again at once. */
export const LOCATION_EDITED_DAYS_READ_ON_EDIT = 8;

/** Location reads in flight at once while the List loads its days. */
export const LOCATION_TIMELINE_CONCURRENCY = 3;

/**
 * Calendar › List's continuous days (owner, 24 Oct 2026): each shown day's location timeline, read at
 * most LOCATION_TIMELINE_CONCURRENCY at a time. A day is read once; `liveDates` (the selected day and
 * today) again whenever `liveKey` changes (the runtime's bootstrap refresh), and every day again when
 * `staleKey` changes (an edit or a correction). A day asked for again while its read is out is read
 * once more when that read lands, so no refresh is lost.
 *
 * With a `focusDate` (the List's top day), an edit re-reads at once only the days read within LIST_REFRESH_RADIUS_DAYS of
 * it and the edited blocks' own days (`affectedDates`); every other day read is stale, as is every day but the live ones
 * after a bootstrap refresh, and is read again when the List's top day comes within that radius of it. A failed read
 * leaves the day stale (request-storm fix, 30 Oct 2026: an edit used to re-read every day the List had ever loaded, 69
 * reads after nine weeks of scroll).
 *
 * Days belong to one owner lifetime (workspace and user): every owner change starts a new generation,
 * dropping the days read and aborting the reads in flight, so even an A → B → A round trip never shows
 * A's earlier days. Unmounting aborts every read and stops the queue. A failed read keeps the day's last
 * copy; a day without one shows blocks (and its checks) only, as before.
 */
export function useLocationTimelines(...args: Parameters<typeof useLocationTimelinesWithStatus>): ReadonlyMap<string, LocationTimeline> {
  return useLocationTimelinesWithStatus(...args).days;
}

/**
 * The same, with the days whose newest read again failed (shown from their old copy, Codex r2 on #634) and a way to read
 * days again now (Try again).
 */
export function useLocationTimelinesWithStatus(dates: readonly string[], liveDates: readonly string[], liveKey: unknown, staleKey: unknown,
  owner: string, enabled = true, focusDate: string | null = null, affectedDates: readonly string[] = []): {
  days: ReadonlyMap<string, LocationTimeline>;
  failedDays: readonly string[];
  retry: (dates: readonly string[]) => void;
} {
  // The owner lifetime, kept in state so the render that sees a change already shows nothing of the owner left.
  const [scope, setScope] = useState({ owner, generation: 0 });
  let generation = scope.generation;
  if (scope.owner !== owner) {
    generation = scope.generation + 1;
    setScope({ owner, generation });
  }
  const [loaded, setLoaded] = useState<{ generation: number; days: ReadonlyMap<string, LocationTimeline> }>({ generation: 0, days: new Map() });
  const [failed, setFailed] = useState<{ generation: number; days: ReadonlySet<string> }>({ generation: 0, days: new Set() });
  const queueRef = useRef<TimelineQueue | null>(null);
  const datesKey = dates.join(",");
  const liveDatesKey = liveDates.join(",");

  const queueFor = (forGeneration: number) => {
    if (queueRef.current?.generation !== forGeneration) {
      queueRef.current?.dispose();
      queueRef.current = createTimelineQueue(forGeneration, (date, timeline) => {
        setLoaded((current) => {
          const days = new Map(current.generation === forGeneration ? current.days : []);
          // Kept in read order (oldest read first), so a trip read on two days takes its freshest copy.
          days.delete(date);
          days.set(date, timeline);
          return { generation: forGeneration, days };
        });
      }, (date, isFailed) => setFailed((current) => {
        const days = new Set(current.generation === forGeneration ? current.days : []);
        if (current.generation === forGeneration && days.has(date) === isFailed) return current;
        if (isFailed) days.add(date);
        else days.delete(date);
        return { generation: forGeneration, days };
      }));
    }
    return queueRef.current;
  };

  // Not shown (Calendar instead of List): the queue stops and its reads are aborted; the days read stay,
  // and a return reads the shown days again (Codex r9 on #584).
  useEffect(() => {
    if (enabled) return;
    queueRef.current?.dispose();
    queueRef.current = null;
  }, [enabled]);
  // Any day not asked for yet is due.
  useEffect(() => {
    if (!enabled) return;
    const queue = queueFor(generation);
    queue.want(datesKey ? datesKey.split(",") : [], false);
  }, [datesKey, enabled, generation]);
  // The selected day and today again with each bootstrap refresh; every other day read is stale (read when visited).
  const lastLiveKeyRef = useRef(liveKey);
  useEffect(() => {
    if (!enabled) return;
    const queue = queueFor(generation);
    const live = liveDatesKey ? liveDatesKey.split(",") : [];
    if (lastLiveKeyRef.current !== liveKey) {
      lastLiveKeyRef.current = liveKey;
      queue.markStale([...queue.asked].filter((date) => !live.includes(date)));
    }
    queue.want(live, true);
  }, [enabled, liveDatesKey, liveKey, generation]);
  // After an edit: the days near the List's top day and the edited days at once; every other day read is stale.
  const refreshWindow = listRefreshWindow(focusDate);
  const windowKey = refreshWindow ? `${refreshWindow.from}..${refreshWindow.to}` : "";
  const lastStaleRef = useRef(staleKey);
  useEffect(() => {
    if (lastStaleRef.current === staleKey) return;
    lastStaleRef.current = staleKey;
    if (!enabled) return;
    const queue = queueFor(generation);
    const asked = [...queue.asked];
    queue.markStale(asked);
    const edited = new Set(affectedDates.filter((date) => queue.asked.has(date)).slice(0, LOCATION_EDITED_DAYS_READ_ON_EDIT));
    queue.want(asked.filter((date) => inListRefreshWindow(date, refreshWindow) || edited.has(date)), true);
    // The window and the edited days are read from this render; the effect runs only for a new edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, generation, staleKey]);
  // The stale days of the window the List's top day has come to (at most 2 × LIST_REFRESH_RADIUS_DAYS + 1), and of the
  // stale days with no places it passed over, at most LOCATION_GAP_DAYS_READ_ON_SCROLL nearest the destination (such a
  // day may have no heading, so the top day can never be on it; Codex r2 on #634). A day still being read is left to it.
  const previousFocusRef = useRef(focusDate);
  const loadedRef = useRef(loaded);
  useLayoutEffect(() => {
    loadedRef.current = loaded;
  });
  useEffect(() => {
    const from = previousFocusRef.current;
    previousFocusRef.current = focusDate;
    if (!enabled) return;
    const queue = queueRef.current;
    if (!queue || queue.generation !== generation || !queue.stale.size) return;
    const due = [...queue.stale.keys()].filter((date) => inListRefreshWindow(date, refreshWindow) && !queue.reading(date));
    if (from && focusDate && from !== focusDate) {
      const [low, high] = from < focusDate ? [from, focusDate] : [focusDate, from];
      const days = loadedRef.current.generation === generation ? loadedRef.current.days : EMPTY_TIMELINES;
      due.push(...[...queue.stale.keys()]
        .filter((date) => date >= low && date <= high && !inListRefreshWindow(date, refreshWindow) && !queue.reading(date) &&
          !(days.get(date)?.items.length))
        .sort((left, right) => (left > right ? -1 : 1) * (focusDate < from ? -1 : 1))
        .slice(0, LOCATION_GAP_DAYS_READ_ON_SCROLL));
    }
    if (due.length) queue.want(due, true);
    // `windowKey` stands for the window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, generation, windowKey]);
  const retry = useCallback((retryDates: readonly string[]) => {
    const queue = queueRef.current;
    if (enabled && queue) queue.want(retryDates.filter((date) => queue.asked.has(date)), true);
  }, [enabled]);
  // Leaving: every read is aborted and the queue stops.
  useEffect(() => () => {
    queueRef.current?.dispose();
    queueRef.current = null;
  }, []);

  return {
    days: loaded.generation === generation ? loaded.days : EMPTY_TIMELINES,
    failedDays: failed.generation === generation ? [...failed.days] : NO_FAILED_DAYS,
    retry
  };
}

const NO_FAILED_DAYS: readonly string[] = [];

type TimelineQueue = {
  generation: number;
  /** Days ever asked for in this lifetime. */
  asked: Set<string>;
  /** Days whose copy may be out of date (after an edit or a bootstrap refresh), each with its mark. */
  stale: Map<string, number>;
  /** Marks days stale: only a read started after this, and successful, clears them. */
  markStale: (dates: readonly string[]) => void;
  /** Whether a day's read is out. */
  reading: (date: string) => boolean;
  /** Asks for days: unread ones always; with `again`, read ones too (after a read in flight lands). */
  want: (dates: readonly string[], again: boolean) => void;
  dispose: () => void;
};

function createTimelineQueue(generation: number, onRead: (date: string, timeline: LocationTimeline) => void,
  onFailed: (date: string, failed: boolean) => void = () => undefined): TimelineQueue {
  const due = new Set<string>();
  const inFlight = new Map<string, AbortController>();
  const againAfterFlight = new Set<string>();
  const asked = new Set<string>();
  const stale = new Map<string, number>();
  let mark = 0;
  let disposed = false;
  const drain = () => {
    while (!disposed && inFlight.size < LOCATION_TIMELINE_CONCURRENCY && due.size) {
      const date = due.values().next().value as string;
      due.delete(date);
      const controller = new AbortController();
      inFlight.set(date, controller);
      asked.add(date);
      const startedAt = mark;
      clientFetch(`/api/timeline?date=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => (response.ok ? (await response.json()) as LocationTimeline : null))
        .catch(() => null)
        .then((next) => {
          if (disposed) return;
          inFlight.delete(date);
          if (!next || next.date !== date) onFailed(date, true);
          if (next && next.date === date) {
            onRead(date, next);
            onFailed(date, false);
            // Fresh only when read after it was marked; a failed read leaves it stale, so the next visit reads it again.
            const marked = stale.get(date);
            if (marked !== undefined && marked <= startedAt) stale.delete(date);
          }
          if (againAfterFlight.delete(date)) due.add(date);
          drain();
        });
    }
  };
  return {
    generation,
    asked,
    stale,
    markStale(dates) {
      mark += 1;
      for (const date of dates) stale.set(date, mark);
    },
    reading: (date) => inFlight.has(date),
    want(dates, again) {
      if (disposed) return;
      for (const date of dates) {
        if (inFlight.has(date)) {
          if (again) againAfterFlight.add(date);
        } else if (again ? asked.has(date) : !asked.has(date)) {
          due.add(date);
        }
      }
      drain();
    },
    dispose() {
      disposed = true;
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
      due.clear();
    }
  };
}

const EMPTY_TIMELINES: ReadonlyMap<string, LocationTimeline> = new Map();

/** A place's span on the shown day: from where the day clips it, to its end (or "since" while you are there). */
function timeSpan(fromMs: number, endMs: number, open: boolean, clock: ClockFormat) {
  const from = formatTime(new Date(fromMs), clock);
  return open ? `since ${from}` : `${from}–${formatTime(new Date(endMs), clock)}`;
}

/**
 * One location row of the List (owner, 28 Oct 2026): a place that needs you, or a quiet one with "All places", or the
 * journey in progress. The row is one button that opens the place's dialog (its "?" asked at the top); its mark is
 * the place's own icon with the amber dot when it asks something, and a confident guess has a Yes pill on the row.
 */
export function LocationListRowView({ check, clock, guess = null, nowMs, onCorrect, onYes, row }: {
  /** The one-tap Yes on the row, for a confident guess (owner item B). */
  onYes?: () => void;
  /** The question's best guess, shown on the row as "Boots?" (owner Q7, 28 Oct 2026). */
  guess?: string | null;
  /** The row's "?" (location v4 step 14): whether its question is open, and the toggle. */
  check?: { expanded: boolean; onToggle: () => void };
  clock: ClockFormat; nowMs: number; onCorrect?: (place: TimelinePlace, label: string) => void;
  row: Exclude<LocationListRow, { kind: "check" }>;
}) {
  if (row.kind === "open_trip") {
    return (
      <tr className="timeline-list-row timeline-location-row align-middle" data-location-row="open-trip">
        <td className="px-3 py-3">
          <div className="timeline-task-cell is-single">
            <span aria-hidden="true" className="timeline-location-mark"><DayframeIcon glyph={DAYFRAME_APP_ICONS.openTrip} size={16} /></span>
            <span className="timeline-task-details">
              <span className="timeline-task-primary-line"><b>Travelling since {formatTime(row.startedAt, clock)}</b></span>
              <span className="timeline-location-secondary">From {row.fromName ?? "Unknown place"} · so far</span>
              {row.legs.length ? <TripModesLine legs={row.legs} /> : null}
            </span>
          </div>
        </td>
        <td className="tabular px-3 py-3"><div className="timeline-list-time-content timeline-location-note">Logs when you arrive</div></td>
        <td className="tabular px-3 py-3 timeline-list-duration">
          <div className="timeline-list-duration-content">{formatDuration(Math.max(0, Math.round((nowMs - Date.parse(row.startedAt)) / 1000)))}</div>
        </td>
        <td className="px-3 py-3" />
      </tr>
    );
  }
  const { place } = row;
  const open = place.stoppedAt == null;
  const span = timeSpan(row.fromMs, row.spanEndMs, open, clock);
  const label = place.name ?? (place.matchKind === "ambiguous" ? "Unclear place" : "Unknown place");
  const length = Math.max(0, Math.round((row.spanEndMs - row.fromMs) / 1000));
  const asking = Boolean(check && row.checkIds.length);
  // Q7: an unnamed place that asks "Visited Boots?" reads "Boots?" on its row.
  const shownLabel = asking && guess && !place.name ? `${guess}?` : label;
  // Owner item A: the row opens the place's dialog (its "?" asked at the top).
  const opens = onCorrect ? () => onCorrect(place, label) : asking ? check!.onToggle : undefined;
  const glyph = place.role === "home" ? DAYFRAME_APP_ICONS.placeHome : place.role === "work" ? DAYFRAME_APP_ICONS.placeWork
    : DAYFRAME_APP_ICONS.places;
  const notInBlock = row.unloggedSeconds >= 60 && row.unloggedSeconds < length - 59 ? `${formatDuration(row.unloggedSeconds)} not in a block` : null;
  const secondary = [row.faint ? null : notInBlock, place.setByYou ? "You set this" : null].filter(Boolean).join(" · ");
  return (
    <tr className={`timeline-list-row timeline-location-row align-middle is-v4${row.faint ? " is-quiet" : ""}`} data-location-row={place.id}
      data-row-key={row.key} data-suggestion-id={row.checkIds[0] || undefined}>
      <td className="px-3 py-3" colSpan={2}>
        <LocationRowButton asking={asking} checkKey={asking ? row.key : undefined} expanded={onCorrect ? undefined : check?.expanded}
          hint={opens ? "Opens the place" : undefined}
          label={`${shownLabel}, ${span}${asking ? ". Needs a look" : ""}${place.setByYou ? ". You set this" : ""}`} onPress={opens}>
          <LocationMark asking={asking} glyph={glyph} quiet={row.faint} />
          <span className="timeline-task-details">
            <span className="timeline-task-primary-line">{row.faint ? <span>{shownLabel}</span> : <b>{shownLabel}</b>}</span>
            {secondary ? <span className="timeline-location-secondary">{secondary}</span> : null}
          </span>
          <span className="tabular timeline-location-span is-stacked">
            <span>{formatTime(new Date(row.fromMs), clock)}</span>
            <span>{open ? "now" : formatTime(new Date(row.spanEndMs), clock)}</span>
          </span>
        </LocationRowButton>
      </td>
      <td className="tabular px-3 py-3 timeline-list-duration">
        <div className="timeline-list-duration-content">{row.faint && notInBlock ? <span className="timeline-location-note">{notInBlock}</span> : formatDuration(length)}</div>
      </td>
      <td className="px-3 py-3">
        {onYes ? <button className="ui-button timeline-check-log is-compact timeline-row-yes" onClick={onYes} type="button">Yes</button> : null}
      </td>
    </tr>
  );
}

/**
 * A location row's mark (owner, 28 Oct 2026, concern 1): a location row's mark is its normal icon in the usual
 * filled square, with one small amber dot when it asks something. No outline, no second "?" box.
 */
export function LocationMark({ asking, glyph, quiet = false }: { asking: boolean; glyph: DayframeGlyph; quiet?: boolean }) {
  return (
    <span aria-hidden="true" className={`timeline-location-mark is-v4${quiet ? " is-faint" : ""}`}>
      <DayframeIcon glyph={glyph} size={16} />
      {asking ? <span className="timeline-location-dot" /> : null}
    </span>
  );
}

/** The whole row is the control: it opens its question (or, with none, the place or trip itself). */
export function LocationRowButton({ asking, checkKey, children, expanded, hint, label, onPress }: {
  asking: boolean; checkKey?: string; children: ReactNode; expanded?: boolean; hint?: string; label: string; onPress?: () => void;
}) {
  if (!onPress) return <div aria-label={label} className="timeline-location-hit" role="group">{children}</div>;
  return (
    <button aria-expanded={asking ? Boolean(expanded) : undefined} aria-label={label} className="timeline-location-hit" data-check-key={checkKey}
      data-tip={hint} onClick={onPress} type="button">
      {children}
    </button>
  );
}

/** Card D item 12: a trip's modes line shows at most three legs, then "+N" (its label still names every leg). */
export const TRIP_MODES_LINE_MAX_LEGS = 3;

/** A trip's route and modes on one line: where it went, then each leg's glyph and name (an unsure leg with "?"). */
export function TripModesLine({ legs, route }: { legs: readonly TripLeg[]; route?: string }) {
  const shown = legs.slice(0, TRIP_MODES_LINE_MAX_LEGS);
  const more = legs.length - shown.length;
  return (
    <span className="timeline-trip-modes" aria-label={`${route ? `${route}. ` : ""}Legs: ${legs.map((leg) => legModeLabel(leg)).join(", ")}`}>
      {route ? <span className="timeline-trip-route">{route}</span> : null}
      {shown.map((leg, index) => (
        <span className="timeline-trip-mode" key={`${leg.startedAt}-${index}`}>
          {index || route ? <span aria-hidden="true">·</span> : null}
          <DayframeIcon glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={13} />
          <span className={leg.confidence === "unsure" ? "is-unsure" : undefined}>
            {leg.confidence === "unsure" ? `${legModeLabel({ ...leg, runnerUp: undefined })}` : legModeLabel(leg)}
          </span>
        </span>
      ))}
      {more > 0 ? <span aria-hidden="true" className="timeline-trip-mode">· +{more}</span> : null}
    </span>
  );
}

/** The expand control on a trip's block. */
export function TripLegsToggle({ expanded, onToggle, title }: { expanded: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} the legs of ${title}`}
      className="timeline-trip-legs-toggle"
      data-tip={expanded ? "Hide legs" : "Show legs"}
      onClick={onToggle}
      type="button"
    >
      <ChevronDown aria-hidden="true" size={16} />
    </button>
  );
}

/**
 * A trip's legs under its block: mode, length, distance and how sure, and when each began. Motion
 * contract: the chevron owns it; the row opens and closes its height (grid rows 0fr ↔ 1fr, 220 ms
 * ease-out) so the rows below move with it rather than jump, and stays mounted until it has closed; a
 * click mid-way reverses it; with Reduce Motion it opens and closes at once.
 */
export function TripLegRows({ clock, expanded, legs, onCorrectLeg }: {
  clock: ClockFormat; expanded: boolean; legs: readonly TripLeg[];
  /** A leg's mode can be set (location v4 step 13): each leg is a button. */
  onCorrectLeg?: (index: number) => void;
}) {
  const [mounted, setMounted] = useState(expanded);
  const [open, setOpen] = useState(expanded);
  // Mount as soon as it opens (adjusting state while rendering), then open once the closed state is styled.
  if (expanded && !mounted) setMounted(true);
  useEffect(() => {
    // Two frames: the closed state is styled first, so opening runs its transition.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setOpen(expanded));
    });
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = expanded ? undefined : setTimeout(() => setMounted(false), reduceMotion ? 0 : TRIP_LEGS_MOTION_MS);
    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [expanded]);
  if (!mounted) return null;
  return (
    <tr className="timeline-trip-legs-row">
      <td colSpan={4}>
        {/* Closing, its legs can't be pressed or focused while it animates away (Codex r2 on #567). */}
        <div className="timeline-trip-legs-wrap" data-open={open && expanded ? "true" : "false"} inert={!expanded}>
        <div className="timeline-trip-legs-clip">
        <ol className="timeline-trip-legs" aria-label="Legs">
          {legs.map((leg, index) => (
            <li className={`timeline-trip-leg${leg.confidence === "unsure" ? " is-unsure" : ""}`} key={`${leg.startedAt}-${index}`}>
              <LegButton label={`Change how you travelled: ${legModeLabel(leg)}, from ${formatTime(leg.startedAt, clock)}`}
                onPress={onCorrectLeg ? () => onCorrectLeg(index) : undefined}>
                <span aria-hidden="true" className="timeline-trip-leg-mark"><DayframeIcon glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={16} /></span>
                <span className="timeline-trip-leg-text">
                  <b>{legModeLabel(leg)} · {formatDuration(Math.max(0, Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000)))}</b>
                  {legDetail(leg) ? <small>{legDetail(leg)}</small> : null}
                </span>
                <span className="tabular timeline-trip-leg-time">{formatTime(leg.startedAt, clock)}</span>
              </LegButton>
            </li>
          ))}
        </ol>
        </div>
        </div>
      </td>
    </tr>
  );
}

/** A leg's row: a button when its mode can be set, its contents alone otherwise. */
function LegButton({ children, label, onPress }: { children: ReactNode; label: string; onPress?: () => void }) {
  if (!onPress) return <>{children}</>;
  return <button aria-label={label} className="timeline-trip-leg-button" onClick={onPress} type="button">{children}</button>;
}

/** How long the legs row takes to open or close; matches `.timeline-trip-legs-wrap` in globals.css. */
const TRIP_LEGS_MOTION_MS = 220;
