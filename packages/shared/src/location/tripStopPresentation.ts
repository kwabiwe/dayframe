import { formatDuration } from "../durations";

/** A coordinate-free stop inside one trip, as carried in Review evidence. */
export type TripStopForPresentation = {
  startedAt: string;
  stoppedAt: string;
  durationSeconds: number;
  approximate: boolean;
};

export type TripStopRow = {
  key: string;
  label: string;
  accessibilityLabel: string;
};

/** The shared duration ("5m", "1h 5m", "<1m"; UIA-042) and the same whole minutes spoken. */
function minutesLabel(durationSeconds: number) {
  const minutes = Math.floor(Math.max(0, durationSeconds) / 60);
  return {
    short: formatDuration(durationSeconds),
    spoken: minutes < 1 ? "less than a minute" : `${minutes} minute${minutes === 1 ? "" : "s"}`
  };
}

/** Heading for a trip's stop list, or null when the trip has none. */
export function tripStopsHeading(stops: readonly TripStopForPresentation[] | undefined, timeAway = false) {
  const count = stops?.length ?? 0;
  return count === 0 ? null : `${count} stop${count === 1 ? "" : "s"} ${timeAway ? "while you were away" : "on this trip"}`;
}

/**
 * One row per stop, in time order. Stop time is part of the trip, not travel;
 * approximate stops say so in both the visible and the spoken label.
 */
export function tripStopRows(
  stops: readonly TripStopForPresentation[] | undefined,
  formatTime: (value: string) => string
): TripStopRow[] {
  return [...(stops ?? [])]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .map((stop) => {
      const start = formatTime(stop.startedAt);
      const stop_ = formatTime(stop.stoppedAt);
      const duration = minutesLabel(stop.durationSeconds);
      const about = stop.approximate ? "about " : "";
      return {
        key: `${stop.startedAt}-${stop.stoppedAt}`,
        label: `Stopped ${about}${start}–${stop_} · ${duration.short}`,
        accessibilityLabel: `Stopped from ${about}${start} to ${stop_}, ${duration.spoken}${stop.approximate ? ", approximate" : ""}`
      };
    });
}

/** Time away from a saved or learned place: a Review-only absence, not a journey. */
export function isTimeAway(segment: { kind: string; qualificationReason?: string | null }) {
  return segment.kind === "commute" && segment.qualificationReason === "same_place_outing";
}

/** Review title for time away from a place, named when the place is known. */
export function timeAwayTitle(placeName: string | null | undefined) {
  const name = placeName?.trim();
  return name ? `Time away from ${name}` : "Time away";
}
