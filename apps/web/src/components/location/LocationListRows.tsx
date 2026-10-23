"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_LEG_MODE_ICONS,
  legDetail,
  legModeLabel,
  type ClockFormat,
  type LocationListRow,
  type LocationTimeline,
  type TripLeg
} from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { clientFetch } from "@/lib/client-auth-fetch";
import { formatDuration, formatTime } from "@/lib/format";

/**
 * The day's location timeline for Calendar › List (location v4 step 10): fetched for the shown day and
 * again whenever `refreshKey` changes (the runtime's bootstrap refresh). Null until it arrives or when it
 * fails; the List then shows blocks only, as before.
 */
export function useLocationTimeline(date: string | null, refreshKey: unknown) {
  const [timeline, setTimeline] = useState<LocationTimeline | null>(null);
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    clientFetch(`/api/timeline?date=${encodeURIComponent(date)}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? (await response.json()) as LocationTimeline : null))
      .catch(() => null)
      .then((next) => {
        if (!cancelled) setTimeline((current) => next ?? (current?.date === date ? current : null));
      });
    return () => {
      cancelled = true;
    };
  }, [date, refreshKey]);
  return date && timeline?.date === date ? timeline : null;
}

function timeSpan(startedAt: string, endMs: number, open: boolean, clock: ClockFormat) {
  return open ? `since ${formatTime(startedAt, clock)}` : `${formatTime(startedAt, clock)}–${formatTime(new Date(endMs), clock)}`;
}

/** One location row of the List: a place (unlogged, or faint with "Show Home and every place") or the journey in progress. */
export function LocationListRowView({ clock, nowMs, row }: { clock: ClockFormat; nowMs: number; row: LocationListRow }) {
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
  const span = timeSpan(place.startedAt, row.spanEndMs, open, clock);
  const label = place.name ?? (place.matchKind === "ambiguous" ? "Unclear place" : "Unknown place");
  const length = Math.max(0, Math.round((row.spanEndMs - row.fromMs) / 1000));
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
            {place.role === "home" || row.unloggedSeconds < 60 ? "not logged" : `${formatDuration(row.unloggedSeconds)} not logged`}
          </div>
        </td>
        <td className="px-3 py-3" />
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
      <td className="px-3 py-3" />
    </tr>
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
      onClick={onToggle}
      type="button"
    >
      <ChevronDown aria-hidden="true" size={16} />
    </button>
  );
}

/** A trip's legs, opened under its block: mode, length, distance and how sure, and when each began. */
export function TripLegRows({ clock, legs }: { clock: ClockFormat; legs: readonly TripLeg[] }) {
  return (
    <tr className="timeline-trip-legs-row">
      <td colSpan={4}>
        <ol className="timeline-trip-legs" aria-label="Legs">
          {legs.map((leg, index) => (
            <li className={`timeline-trip-leg${leg.confidence === "unsure" ? " is-unsure" : ""}`} key={`${leg.startedAt}-${index}`}>
              <span aria-hidden="true" className="timeline-trip-leg-mark"><DayframeIcon glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={16} /></span>
              <span className="timeline-trip-leg-text">
                <b>{legModeLabel(leg)} · {formatDuration(Math.max(0, Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000)))}</b>
                {legDetail(leg) ? <small>{legDetail(leg)}</small> : null}
              </span>
              <span className="tabular timeline-trip-leg-time">{formatTime(leg.startedAt, clock)}</span>
            </li>
          ))}
        </ol>
      </td>
    </tr>
  );
}

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
