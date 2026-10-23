"use client";

import { useState } from "react";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_LEG_MODE_ICONS,
  LEG_MODE_LABEL,
  type ClockFormat,
  type TimelineCorrectionRequest,
  type TimelinePlace,
  type TripLeg,
  type TripLegMode
} from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { Button, ModalDialog } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { formatDuration, formatTime } from "@/lib/format";

/**
 * Correcting the location timeline on the web (location v4 step 13, mock-up #web-list inspector):
 * a place's place and times, or a leg's mode, through `POST /api/timeline/corrections` (step 11).
 * Opens as the web's standard dialog (a bottom sheet at phone width). Nothing needs approving: what
 * the person leaves alone stays as Dayframe made it.
 */
export type LocationCorrectionTarget =
  | { kind: "place"; place: TimelinePlace; label: string }
  | { kind: "leg"; tripId: string; leg: TripLeg; index: number; count: number };

export type CorrectionPlace = { id: string; name: string; role: string | null };

const LEG_MODES: TripLegMode[] = ["walking", "running", "cycling", "automotive", "bus", "train", "underground", "tram"];

/** "HH:MM" in the viewer's zone, for a time field. */
function timeValue(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The instant of a time field's "HH:MM" on the same local day as `dayOf`. */
function instantOn(dayOf: string, value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const date = new Date(dayOf);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

async function sendCorrection(correction: TimelineCorrectionRequest) {
  const response = await clientFetch("/api/timeline/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(correction)
  });
  if (response.ok) return null;
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? "Couldn't save that. Try again.";
}

export function LocationCorrectionDialog({
  clock,
  onClose,
  onCorrected,
  places,
  target
}: {
  clock: ClockFormat;
  onClose: () => void;
  onCorrected: () => Promise<void> | void;
  places: readonly CorrectionPlace[];
  target: LocationCorrectionTarget;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The place chosen: a saved place, the learned place it already is, or unknown.
  const current = target.kind === "place" ? target.place.placeId ? `saved:${target.place.placeId}`
    : target.place.learnedPlaceId ? `learned:${target.place.learnedPlaceId}` : "unknown" : "unknown";
  const [picked, setPicked] = useState(current);
  const [start, setStart] = useState(target.kind === "place" ? timeValue(target.place.startedAt) : "");
  const [end, setEnd] = useState(target.kind === "place" && target.place.stoppedAt ? timeValue(target.place.stoppedAt) : "");
  const [mode, setMode] = useState<TripLegMode>(target.kind === "leg" ? target.leg.mode : "walking");

  function corrections(): TimelineCorrectionRequest[] | string {
    if (target.kind === "leg") {
      return mode === target.leg.mode && target.leg.confidence === "sure" ? [] : [{
        kind: "leg_mode", subject: "leg", itemId: target.tripId, legStartedAt: target.leg.startedAt, legStoppedAt: target.leg.stoppedAt, mode
      }];
    }
    const { place } = target;
    const out: TimelineCorrectionRequest[] = [];
    if (picked !== current) {
      out.push({ kind: "place", subject: "place", itemId: place.id,
        placeId: picked.startsWith("saved:") ? picked.slice(6) : null,
        learnedPlaceId: picked.startsWith("learned:") ? picked.slice(8) : null });
    }
    if (place.stoppedAt && (start !== timeValue(place.startedAt) || end !== timeValue(place.stoppedAt))) {
      if (!start || !end) return "Enter a start and an end.";
      const startedAt = instantOn(place.startedAt, start);
      const stoppedAt = instantOn(place.stoppedAt, end);
      if (Date.parse(stoppedAt) <= Date.parse(startedAt)) return "The end must be after the start.";
      out.push({ kind: "times", subject: "place", itemId: place.id, startedAt, stoppedAt });
    }
    return out;
  }

  async function apply() {
    const pending = corrections();
    if (typeof pending === "string") {
      setError(pending);
      return;
    }
    if (!pending.length) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    for (const correction of pending) {
      const failure = await sendCorrection(correction).catch(() => "Couldn't save that. Check your connection and try again.");
      if (failure) {
        setBusy(false);
        setError(failure);
        return;
      }
    }
    await onCorrected();
    setBusy(false);
    onClose();
  }

  const footer = (
    <>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      <Button disabled={busy} onClick={() => void apply()} variant="primary">Done</Button>
    </>
  );

  if (target.kind === "leg") {
    const { leg } = target;
    const minutes = Math.max(0, Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000));
    return (
      <ModalDialog busy={busy} description={`Leg ${target.index + 1} of ${target.count} · ${formatTime(leg.startedAt, clock)}–${formatTime(leg.stoppedAt, clock)}`}
        footer={footer} onClose={onClose} size="compact" title={`${LEG_MODE_LABEL[mode]} · ${formatDuration(minutes)}`}>
        <div className="location-correction">
          <span className="location-correction-label" id="location-correction-mode">How did you travel?</span>
          <div aria-labelledby="location-correction-mode" className="location-correction-modes" role="group">
            {LEG_MODES.map((option) => (
              <button aria-pressed={mode === option} className="location-correction-mode" key={option} onClick={() => setMode(option)} type="button">
                <DayframeIcon glyph={DAYFRAME_LEG_MODE_ICONS[option]} size={18} />
                {LEG_MODE_LABEL[option]}
              </button>
            ))}
          </div>
          {error ? <p className="location-correction-error" role="alert">{error}</p> : null}
        </div>
      </ModalDialog>
    );
  }

  const { place } = target;
  const open = place.stoppedAt == null;
  return (
    <ModalDialog busy={busy} description={open ? `Since ${formatTime(place.startedAt, clock)}`
      : `${formatTime(place.startedAt, clock)}–${formatTime(place.stoppedAt!, clock)}`}
      footer={footer} onClose={onClose} size="compact" title={target.label}>
      <div className="location-correction">
        <span className="location-correction-label" id="location-correction-place">Where were you?</span>
        <div aria-labelledby="location-correction-place" className="location-correction-options" role="radiogroup">
          {place.learnedPlaceId && !place.placeId ? (
            <button aria-checked={picked === current} className="location-correction-option" onClick={() => setPicked(current)} role="radio" type="button">
              <DayframeIcon glyph={DAYFRAME_APP_ICONS.places} size={18} />
              <span><b>{place.name ?? "Learned place"}</b><small>Learned place</small></span>
            </button>
          ) : null}
          {places.map((option) => (
            <button aria-checked={picked === `saved:${option.id}`} className="location-correction-option" key={option.id}
              onClick={() => setPicked(`saved:${option.id}`)} role="radio" type="button">
              <DayframeIcon glyph={option.role === "home" ? DAYFRAME_APP_ICONS.placeHome : option.role === "work" ? DAYFRAME_APP_ICONS.placeWork
                : DAYFRAME_APP_ICONS.places} size={18} />
              <span><b>{option.name}</b><small>Saved place</small></span>
            </button>
          ))}
          <button aria-checked={picked === "unknown"} className="location-correction-option" onClick={() => setPicked("unknown")} role="radio" type="button">
            <DayframeIcon glyph={DAYFRAME_APP_ICONS.placeUnknown} size={18} />
            <span><b>Leave as unknown</b><small>Keeps it as an unknown place until you name it</small></span>
          </button>
        </div>
        <p className="location-correction-hint">Nearby suggestions come from Apple Maps, so they show on your iPhone. The web shows places you saved.</p>
        {open ? null : (
          <>
            <span className="location-correction-label" id="location-correction-times">Times</span>
            <div aria-labelledby="location-correction-times" className="location-correction-times" role="group">
              <label className="location-correction-time"><span>Start</span>
                <input onChange={(event) => setStart(event.target.value)} type="time" value={start} />
              </label>
              <label className="location-correction-time"><span>End</span>
                <input onChange={(event) => setEnd(event.target.value)} type="time" value={end} />
              </label>
            </div>
          </>
        )}
        {error ? <p className="location-correction-error" role="alert">{error}</p> : null}
      </div>
    </ModalDialog>
  );
}
