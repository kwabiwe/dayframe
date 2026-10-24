"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_LEG_MODE_ICONS,
  legDetail,
  legModeLabel,
  type ClockFormat,
  type LocationListRow,
  type LocationTimeline,
  type TimelinePlace,
  type TripLeg
} from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { clientFetch } from "@/lib/client-auth-fetch";
import { formatDuration, formatTime } from "@/lib/format";

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

/** Location reads in flight at once while the List loads its days. */
export const LOCATION_TIMELINE_CONCURRENCY = 3;

/**
 * Calendar › List's continuous days (owner, 24 Oct 2026): each shown day's location timeline, read at
 * most LOCATION_TIMELINE_CONCURRENCY at a time. A day is read once; `liveDates` (the selected day and
 * today) again whenever `liveKey` changes (the runtime's bootstrap refresh), and every day again when
 * `staleKey` changes (an edit or a correction). A day asked for again while its read is out is read
 * once more when that read lands, so no refresh is lost.
 *
 * Days belong to one owner lifetime (workspace and user): every owner change starts a new generation,
 * dropping the days read and aborting the reads in flight, so even an A → B → A round trip never shows
 * A's earlier days. Unmounting aborts every read and stops the queue. A failed read keeps the day's last
 * copy; a day without one shows blocks (and its checks) only, as before.
 */
export function useLocationTimelines(dates: readonly string[], liveDates: readonly string[], liveKey: unknown, staleKey: unknown,
  owner: string): ReadonlyMap<string, LocationTimeline> {
  // The owner lifetime, kept in state so the render that sees a change already shows nothing of the owner left.
  const [scope, setScope] = useState({ owner, generation: 0 });
  let generation = scope.generation;
  if (scope.owner !== owner) {
    generation = scope.generation + 1;
    setScope({ owner, generation });
  }
  const [loaded, setLoaded] = useState<{ generation: number; days: ReadonlyMap<string, LocationTimeline> }>({ generation: 0, days: new Map() });
  const queueRef = useRef<TimelineQueue | null>(null);
  const datesKey = dates.join(",");
  const liveDatesKey = liveDates.join(",");

  const queueFor = (forGeneration: number) => {
    if (queueRef.current?.generation !== forGeneration) {
      queueRef.current?.dispose();
      queueRef.current = createTimelineQueue(forGeneration, (date, timeline) => {
        setLoaded((current) => {
          const days = new Map(current.generation === forGeneration ? current.days : []);
          days.set(date, timeline);
          return { generation: forGeneration, days };
        });
      });
    }
    return queueRef.current;
  };

  // Any day not asked for yet is due.
  useEffect(() => {
    const queue = queueFor(generation);
    queue.want(datesKey ? datesKey.split(",") : [], false);
  }, [datesKey, generation]);
  // The selected day and today again with each bootstrap refresh.
  useEffect(() => {
    queueFor(generation).want(liveDatesKey ? liveDatesKey.split(",") : [], true);
  }, [liveDatesKey, liveKey, generation]);
  // Every day again after an edit.
  const lastStaleRef = useRef(staleKey);
  useEffect(() => {
    if (lastStaleRef.current === staleKey) return;
    lastStaleRef.current = staleKey;
    const queue = queueFor(generation);
    queue.want([...queue.asked], true);
  }, [generation, staleKey]);
  // Leaving: every read is aborted and the queue stops.
  useEffect(() => () => {
    queueRef.current?.dispose();
    queueRef.current = null;
  }, []);

  return loaded.generation === generation ? loaded.days : EMPTY_TIMELINES;
}

type TimelineQueue = {
  generation: number;
  /** Days ever asked for in this lifetime. */
  asked: Set<string>;
  /** Asks for days: unread ones always; with `again`, read ones too (after a read in flight lands). */
  want: (dates: readonly string[], again: boolean) => void;
  dispose: () => void;
};

function createTimelineQueue(generation: number, onRead: (date: string, timeline: LocationTimeline) => void): TimelineQueue {
  const due = new Set<string>();
  const inFlight = new Map<string, AbortController>();
  const againAfterFlight = new Set<string>();
  const asked = new Set<string>();
  let disposed = false;
  const drain = () => {
    while (!disposed && inFlight.size < LOCATION_TIMELINE_CONCURRENCY && due.size) {
      const date = due.values().next().value as string;
      due.delete(date);
      const controller = new AbortController();
      inFlight.set(date, controller);
      asked.add(date);
      clientFetch(`/api/timeline?date=${encodeURIComponent(date)}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => (response.ok ? (await response.json()) as LocationTimeline : null))
        .catch(() => null)
        .then((next) => {
          if (disposed) return;
          inFlight.delete(date);
          if (next && next.date === date) onRead(date, next);
          if (againAfterFlight.delete(date)) due.add(date);
          drain();
        });
    }
  };
  return {
    generation,
    asked,
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
 * One location row of the List: a place (unlogged, or faint with "Show Home and every place") or the
 * journey in progress. A place not in a block can be corrected (location v4 step 13).
 */
export function LocationListRowView({ check, clock, nowMs, onCorrect, row }: {
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
  const correct = (onCorrect && !place.blockIds.length) || (check && row.checkIds.length) ? (
    <div className="timeline-list-actions">
      {check && row.checkIds.length ? <CheckToggle checkKey={row.key} expanded={check.expanded} label={label} onToggle={check.onToggle} /> : null}
      {onCorrect && !place.blockIds.length ? (
        <button aria-label={`Correct ${label}`} className="df-icon-action" data-tip="Correct" onClick={() => onCorrect(place, label)} type="button">
          <DayframeIcon glyph="pencil" size={16} />
        </button>
      ) : null}
    </div>
  ) : null;
  if (row.faint) {
    const glyph = place.role === "home" ? DAYFRAME_APP_ICONS.placeHome : place.role === "work" ? DAYFRAME_APP_ICONS.placeWork
      : DAYFRAME_APP_ICONS.places;
    return (
      <tr className="timeline-list-row timeline-location-row is-faint align-middle" data-location-row={place.id}>
        <td className="px-3 py-3">
          <div className="timeline-task-cell is-single">
            <span aria-hidden="true" className="timeline-location-mark is-faint"><DayframeIcon glyph={glyph} size={16} /></span>
            <span className="timeline-task-details">
              <span className="timeline-task-primary-line">{label} · {span}</span>
            </span>
          </div>
        </td>
        {/* The span is in the title (mock-up #web-list): the time column stays empty. */}
        <td className="tabular px-3 py-3" />
        <td className="tabular px-3 py-3 timeline-list-duration">
          <div className="timeline-list-duration-content timeline-location-note">
            {row.unloggedSeconds < 60 ? "logged" : place.role === "home" ? "not logged" : `${formatDuration(row.unloggedSeconds)} not logged`}
          </div>
        </td>
        <td className="px-3 py-3">{correct}</td>
      </tr>
    );
  }
  return (
    <tr className="timeline-list-row timeline-location-row align-middle" data-location-row={place.id}>
      <td className="px-3 py-3">
        <div className="timeline-task-cell is-single">
          <span aria-hidden="true" className="timeline-location-mark is-unknown"><DayframeIcon glyph={DAYFRAME_APP_ICONS.placeUnknown} size={16} /></span>
          <span className="timeline-task-details">
            <span className="timeline-task-primary-line"><b>{label}</b></span>
            <span className="timeline-location-secondary">{formatDuration(row.unloggedSeconds)} not in a block</span>
          </span>
        </div>
      </td>
      <td className="tabular px-3 py-3"><div className="timeline-list-time-content">{span}</div></td>
      <td className="tabular px-3 py-3 timeline-list-duration"><div className="timeline-list-duration-content">{formatDuration(length)}</div></td>
      <td className="px-3 py-3">{correct}</td>
    </tr>
  );
}

/** A row's "?": opens its question under the row. */
export function CheckToggle({ checkKey, expanded, label, onToggle }: { checkKey: string; expanded: boolean; label: string; onToggle: () => void }) {
  return (
    <button aria-expanded={expanded} aria-label={`Check ${label}`} className="df-icon-action timeline-check-toggle" data-check-key={checkKey}
      data-tip="Check"
      onClick={onToggle} type="button">
      <DayframeIcon glyph={DAYFRAME_APP_ICONS.placeUnknown} size={16} />
    </button>
  );
}

/** A trip's route and modes on one line: where it went, then each leg's glyph and name (an unsure leg with "?"). */
export function TripModesLine({ legs, route }: { legs: readonly TripLeg[]; route?: string }) {
  return (
    <span className="timeline-trip-modes" aria-label={`${route ? `${route}. ` : ""}Legs: ${legs.map((leg) => legModeLabel(leg)).join(", ")}`}>
      {route ? <span className="timeline-trip-route">{route}</span> : null}
      {legs.map((leg, index) => (
        <span className="timeline-trip-mode" key={`${leg.startedAt}-${index}`}>
          {index || route ? <span aria-hidden="true">·</span> : null}
          <DayframeIcon glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={13} />
          <span className={leg.confidence === "unsure" ? "is-unsure" : undefined}>
            {leg.confidence === "unsure" ? `${legModeLabel({ ...leg, runnerUp: undefined })}` : legModeLabel(leg)}
          </span>
        </span>
      ))}
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

/** "Show Home and every place" under the List. */
export function ShowEveryPlaceToggle({ onToggle, pressed }: { onToggle: () => void; pressed: boolean }) {
  return (
    <div className="timeline-location-foot">
      {/* A secondary text button is text only (web buttons rule W10). */}
      <button aria-pressed={pressed} className="timeline-location-chip" onClick={onToggle} type="button">
        {pressed ? "Hide Home and logged places" : "Show Home and every place"}
      </button>
    </div>
  );
}
