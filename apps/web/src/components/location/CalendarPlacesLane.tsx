"use client";

import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_LEG_MODE_ICONS,
  legModeLabel,
  type ClockFormat,
  type LocationTimeline,
  type TimelinePlace,
  type TimelineTrip,
  type TripLeg
} from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { formatTime } from "@/lib/format";

/**
 * Calendar, location v4 steps 16–17 (location v4 §11, mock-ups #web-grid, #ios-grid).
 *
 * Step 16: a trip block shows its legs as a strip down its left edge from 44 px tall: one segment per leg in
 * proportion to its time, an icon where a segment has room, an Unsure leg hatched.
 *
 * Step 17: the Places lane, about a fifth of the day column on days with any place besides Home: each place
 * and trip at its time, quiet; one that asks something is hatched with the amber dot and opens its question in
 * the List. Every other item opens the List on its day (the place, its map and corrections are there).
 */

/** The lane's width in a day column this wide, or 0 for a day with no place besides Home. */
export function placesLaneWidth(timeline: LocationTimeline, dayBodyWidth: number) {
  const besidesHome = timeline.items.some((item) => item.kind === "trip" || (item.kind === "place" && item.role !== "home" && item.name !== "Home"));
  if (!besidesHome || dayBodyWidth <= 0) return 0;
  return Math.round(Math.min(72, Math.max(22, dayBodyWidth * 0.2)));
}

export function CalendarLegStrip({ fromMs, legs, toMs }: { fromMs: number; legs: readonly TripLeg[]; toMs: number }) {
  const span = Math.max(1, toMs - fromMs);
  return (
    <span aria-hidden="true" className="calendar-leg-strip">
      {legs.map((leg, index) => {
        const start = Math.max(fromMs, Date.parse(leg.startedAt));
        const end = Math.min(toMs, Date.parse(leg.stoppedAt));
        if (!(end > start)) return null;
        return (
          <span className={`calendar-leg-segment${leg.confidence === "unsure" ? " is-unsure" : ""}`} key={`${leg.startedAt}-${index}`}
            style={{ top: `${((start - fromMs) / span) * 100}%`, height: `${((end - start) / span) * 100}%` }}>
            <DayframeIcon glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={11} />
          </span>
        );
      })}
    </span>
  );
}

export function CalendarPlacesLane({ asking, clock, geometry, onOpen, timeline, widthPx }: {
  /** Owner item A: every item opens its own dialog (its "?" asked at the top). */
  onOpen: (item: TimelinePlace | TimelineTrip, checkId: string | null) => void;
  /** The "?" still asking, by the place or trip it is about. */
  asking: ReadonlyMap<string, string>;
  clock: ClockFormat;
  /** Where a span sits in this day column, or null when it falls outside the shown hours. */
  geometry: (startedAt: string, stoppedAt: string) => { top: number; height: number } | null;
  timeline: LocationTimeline;
  widthPx: number;
}) {
  const nowIso = new Date().toISOString();
  const names = new Map(timeline.items.flatMap((item) => item.kind === "place" ? [[item.id, item.name] as const] : []));
  return (
    <div aria-label="Places and trips" className="calendar-places-lane" role="group" style={{ width: widthPx }}>
      {timeline.items.map((item) => {
        const box = geometry(item.startedAt, item.stoppedAt ?? nowIso);
        if (!box) return null;
        const checkId = asking.get(item.id);
        const label = item.kind === "place"
          ? item.name ?? (item.matchKind === "ambiguous" ? "Unclear place" : "Unknown place")
          : `${names.get(item.fromId) ?? "Unknown place"} → ${names.get(item.toId) ?? "Unknown place"}`;
        const when = `${formatTime(item.startedAt, clock)}–${item.stoppedAt ? formatTime(item.stoppedAt, clock) : "now"}`;
        const legs = item.kind === "trip" && item.legs.length ? `. ${item.legs.map((leg) => legModeLabel(leg)).join(", ")}` : "";
        const glyph = item.kind === "trip" ? DAYFRAME_APP_ICONS.openTrip : item.role === "home" ? DAYFRAME_APP_ICONS.placeHome
          : item.role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places;
        return (
          <button aria-label={`${label}, ${when}${legs}${checkId ? ". Needs a look" : ""}`}
            className={`calendar-places-item is-${item.kind}${checkId ? " is-asking" : ""}`} data-tip={`${label} · ${when}`}
            key={item.id} onClick={(event) => { event.stopPropagation(); onOpen(item, checkId ?? null); }}
            onPointerDown={(event) => event.stopPropagation()} style={{ top: box.top, height: Math.max(box.height, 3) }} type="button">
            {box.height >= 18 && widthPx >= 30 ? <DayframeIcon glyph={glyph} size={12} /> : null}
            {checkId ? <span className="calendar-places-dot" /> : null}
          </button>
        );
      })}
    </div>
  );
}
