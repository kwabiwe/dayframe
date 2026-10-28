"use client";

import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_LEG_MODE_ICONS,
  legModeLabel,
  type ClockFormat,
  type LocationTimeline,
  type TimelinePlace,
  type TimelineTrip,
  type TripLeg,
  uncoveredSeconds
} from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { PrototypeMark } from "@/components/location/LocationListRows";
import { formatDate, formatDuration, formatTime } from "@/lib/format";

/**
 * Card F (Calendar prototype, owner 28 Oct 2026): on wide web, a "Places and trips" column beside the blocks —
 * every place of the day at the top of the List (Home included, logged ones too) and every trip with its legs,
 * newest first like the List. A place that asks something carries the amber dot and opens its question in the
 * List; any other place opens its correction (with the map); a leg opens how you travelled. "Hide" folds the
 * column away (remembered on this device); the List then shows its rows inline with "Show all places".
 */
export function PlacesColumn({
  askingBySegment,
  blocks,
  clock,
  nowMs,
  onCorrectLeg,
  onCorrectPlace,
  onHide,
  onOpenCheck,
  timeline
}: {
  /** The "?" that still ask, by the place or trip they are about. */
  askingBySegment: ReadonlyMap<string, string>;
  /** The day's blocks, so a place your blocks cover reads "In a block" whichever block covers it. */
  blocks: ReadonlyArray<{ startedAt: string; stoppedAt: string | null }>;
  clock: ClockFormat;
  nowMs: number;
  onCorrectLeg: (trip: TimelineTrip, index: number) => void;
  onCorrectPlace: (place: TimelinePlace, label: string) => void;
  onHide: () => void;
  onOpenCheck: (checkId: string) => void;
  timeline: LocationTimeline | null;
}) {
  const items = [...(timeline?.items ?? [])].filter((item) => item.status !== "ignored")
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  const names = new Map((timeline?.items ?? []).flatMap((item) => item.kind === "place" ? [[item.id, item.name] as const] : []));
  const dayStartMs = timeline ? Date.parse(timeline.dayStart) : null;
  const dayEndMs = timeline ? Date.parse(timeline.dayEnd) : null;
  const span = (startedAt: string, stoppedAt: string | null) => {
    const from = Math.max(Date.parse(startedAt), dayStartMs ?? -Infinity);
    if (!stoppedAt) return `since ${formatTime(new Date(from), clock)}`;
    const to = Math.min(Date.parse(stoppedAt), dayEndMs ?? Infinity);
    return `${formatTime(new Date(from), clock)}–${formatTime(new Date(to), clock)}`;
  };
  return (
    <aside aria-label="Places and trips" className="timeline-places-column">
      <header className="timeline-places-column-head">
        <div>
          <h2>Places and trips</h2>
          {timeline ? <small>{formatDate(timeline.dayStart)}</small> : null}
        </div>
        <button className="timeline-location-chip is-compact" onClick={onHide} type="button">Hide</button>
      </header>
      {!timeline ? <p className="timeline-places-column-empty">Loading the day’s places…</p>
        : !items.length && !timeline.openTrip ? <p className="timeline-places-column-empty">Nowhere recorded on this day.</p> : null}
      <ol className="timeline-places-column-list">
        {timeline?.openTrip ? (
          <li className="timeline-places-column-item">
            <div className="timeline-location-hit">
              <PrototypeMark asking={false} glyph={DAYFRAME_APP_ICONS.openTrip} />
              <span className="timeline-task-details">
                <b>Travelling since {formatTime(timeline.openTrip.startedAt, clock)}</b>
                <small>Logs when you arrive · {formatDuration(Math.max(0, Math.round((nowMs - Date.parse(timeline.openTrip.startedAt)) / 1000)))}</small>
              </span>
            </div>
          </li>
        ) : null}
        {items.map((item) => {
          const asking = askingBySegment.get(item.id);
          if (item.kind === "place") {
            const label = item.name ?? (item.matchKind === "ambiguous" ? "Unclear place" : "Unknown place");
            const glyph = item.role === "home" ? DAYFRAME_APP_ICONS.placeHome : item.role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places;
            const covered = item.blockIds.length > 0 || uncoveredSeconds(Date.parse(item.startedAt), item.stoppedAt ? Date.parse(item.stoppedAt) : nowMs, blocks, nowMs) < 60;
            const note = [covered ? "In a block" : null, item.setByYou ? "You set this" : null].filter(Boolean).join(" · ") || null;
            const open = asking ? () => onOpenCheck(asking) : covered ? undefined : () => onCorrectPlace(item, label);
            const body = (
              <>
                <PrototypeMark asking={Boolean(asking)} glyph={glyph} quiet={!asking && item.matchKind !== "unknown"} />
                <span className="timeline-task-details">
                  <b>{label}</b>
                  <small>{[span(item.startedAt, item.stoppedAt), note].filter(Boolean).join(" · ")}</small>
                </span>
              </>
            );
            return (
              <li className="timeline-places-column-item" key={item.id}>
                {open ? (
                  <button aria-label={`${label}, ${span(item.startedAt, item.stoppedAt)}${asking ? ". Needs a look" : ""}`} className="timeline-location-hit"
                    data-tip={asking ? "Shows the question" : "Opens it to change the place or its times"} onClick={open} type="button">{body}</button>
                ) : <div className="timeline-location-hit">{body}</div>}
              </li>
            );
          }
          const route = `${names.get(item.fromId) ?? "Unknown place"} → ${names.get(item.toId) ?? "Unknown place"}`;
          return (
            <li className="timeline-places-column-item is-trip" key={item.id}>
              {asking ? (
                <button aria-label={`Trip ${route}, ${span(item.startedAt, item.stoppedAt)}. Needs a look`} className="timeline-location-hit"
                  onClick={() => onOpenCheck(asking)} type="button">
                  <TripHead asking route={route} span={span(item.startedAt, item.stoppedAt)} logged={item.blockIds.length > 0} />
                </button>
              ) : (
                <div className="timeline-location-hit"><TripHead asking={false} route={route} span={span(item.startedAt, item.stoppedAt)} logged={item.blockIds.length > 0} /></div>
              )}
              {item.legs.length ? (
                <ol aria-label="Legs" className="timeline-places-column-legs">
                  {item.legs.map((leg, index) => (
                    <li key={`${leg.startedAt}-${index}`}>
                      <button aria-label={`Change how you travelled: ${legModeLabel(leg)}, from ${formatTime(leg.startedAt, clock)}`}
                        className={`timeline-places-column-leg${leg.confidence === "unsure" ? " is-unsure" : ""}`} onClick={() => onCorrectLeg(item, index)} type="button">
                        <DayframeIcon glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={14} />
                        <span>{legModeLabel(leg)}</span>
                        <span className="tabular">{legLength(leg)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function TripHead({ asking, logged, route, span }: { asking: boolean; logged: boolean; route: string; span: string }) {
  return (
    <>
      <PrototypeMark asking={asking} glyph={DAYFRAME_APP_ICONS.openTrip} quiet={!asking} />
      <span className="timeline-task-details">
        <b>{route}</b>
        <small>{[span, logged ? "In a block" : null].filter(Boolean).join(" · ")}</small>
      </span>
    </>
  );
}

function legLength(leg: TripLeg) {
  return formatDuration(Math.max(0, Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000)));
}
