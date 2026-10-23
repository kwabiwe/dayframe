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

/**
 * The instant a time field's "HH:MM" means for the time it replaces: on that time's local day or the day
 * either side, whichever is nearest on the clock (a stay across midnight), in the viewer's zone. Null
 * when that time doesn't exist that day (the hour the clocks go forward).
 */
export function editedInstant(original: string, value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const from = new Date(original);
  // The day by wall-clock distance (so a skipped hour never moves it to another day), then the instant.
  const wall = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes());
  const shift = [-1, 0, 1].reduce((best, candidate) => {
    const at = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate() + candidate, hours, minutes);
    const bestAt = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate() + best, hours, minutes);
    return Math.abs(at - wall) < Math.abs(bestAt - wall) ? candidate : best;
  }, 0);
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + shift, hours, minutes, 0, 0);
  // A time the clocks skip normalises to another hour: it isn't a time that day.
  if (date.getHours() !== hours || date.getMinutes() !== minutes) return null;
  // A time the clocks repeat has two instants: the one nearer the time it replaces (Codex r2 on #567).
  const same = (candidate: Date) => candidate.getHours() === hours && candidate.getMinutes() === minutes;
  const instants = [date, new Date(date.getTime() - 3_600_000), new Date(date.getTime() + 3_600_000)].filter(same);
  const originalMs = from.getTime();
  return instants.reduce((best, candidate) =>
    Math.abs(candidate.getTime() - originalMs) < Math.abs(best.getTime() - originalMs) ? candidate : best).toISOString();
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
  const original = target.kind === "place" ? target.place.placeId ? `saved:${target.place.placeId}`
    : target.place.learnedPlaceId ? `learned:${target.place.learnedPlaceId}` : "unknown" : "unknown";
  const [picked, setPicked] = useState(original);
  const [start, setStart] = useState(target.kind === "place" ? timeValue(target.place.startedAt) : "");
  const [end, setEnd] = useState(target.kind === "place" && target.place.stoppedAt ? timeValue(target.place.stoppedAt) : "");
  const [mode, setMode] = useState<TripLegMode>(target.kind === "leg" ? target.leg.mode : "walking");
  // What the server has now: corrections saved before a later one was refused are the new starting point.
  const [saved, setSaved] = useState(() => ({
    picked: original,
    startedAt: target.kind === "place" ? target.place.startedAt : "",
    stoppedAt: target.kind === "place" ? target.place.stoppedAt : null,
    mode: target.kind === "leg" ? target.leg.mode : "walking" as TripLegMode
  }));

  function corrections(): TimelineCorrectionRequest[] | string {
    // Only what changed is sent: an untouched leg, place or time is left as it is.
    if (target.kind === "leg") {
      return mode === saved.mode ? [] : [{
        kind: "leg_mode", subject: "leg", itemId: target.tripId, legStartedAt: target.leg.startedAt, legStoppedAt: target.leg.stoppedAt, mode
      }];
    }
    const { place } = target;
    const out: TimelineCorrectionRequest[] = [];
    if (picked !== saved.picked) {
      out.push({ kind: "place", subject: "place", itemId: place.id,
        placeId: picked.startsWith("saved:") ? picked.slice(6) : null,
        learnedPlaceId: picked.startsWith("learned:") ? picked.slice(8) : null });
    }
    if (saved.stoppedAt) {
      const startChanged = start !== timeValue(saved.startedAt);
      const endChanged = end !== timeValue(saved.stoppedAt);
      if (startChanged || endChanged) {
        if (!start || !end) return "Enter a start and an end.";
        // An untouched field keeps its exact instant; an edited one is the nearest instant with that time.
        const startedAt = startChanged ? editedInstant(saved.startedAt, start) : saved.startedAt;
        const stoppedAt = endChanged ? editedInstant(saved.stoppedAt, end) : saved.stoppedAt;
        if (!startedAt || !stoppedAt) return "That time doesn't exist on that day: the clocks changed.";
        if (Date.parse(stoppedAt) <= Date.parse(startedAt)) return "The end must be after the start.";
        out.push({ kind: "times", subject: "place", itemId: place.id, startedAt, stoppedAt });
      }
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
    let savedAny = false;
    for (const correction of pending) {
      const failure = await sendCorrection(correction).catch(() => "Couldn't save that. Check your connection and try again.");
      if (failure) {
        // What did save is the new starting point, and the List shows it.
        if (savedAny) await onCorrected();
        setBusy(false);
        setError(failure);
        return;
      }
      savedAny = true;
      setSaved((current) => correction.kind === "place" ? { ...current, picked }
        : correction.kind === "times" ? { ...current, startedAt: correction.startedAt, stoppedAt: correction.stoppedAt }
          : correction.kind === "leg_mode" ? { ...current, mode: correction.mode } : current);
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
              <button aria-pressed={mode === option} className="location-correction-mode" disabled={busy} key={option} onClick={() => setMode(option)} type="button">
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
          {[
            ...(place.learnedPlaceId && !place.placeId
              ? [{ key: original, glyph: DAYFRAME_APP_ICONS.places, name: place.name ?? "Learned place", note: "Learned place" }] : []),
            ...places.map((option) => ({ key: `saved:${option.id}`, name: option.name, note: "Saved place",
              glyph: option.role === "home" ? DAYFRAME_APP_ICONS.placeHome : option.role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places })),
            { key: "unknown", glyph: DAYFRAME_APP_ICONS.placeUnknown, name: "Leave as unknown", note: "Keeps it as an unknown place until you name it" }
          ].map((option) => (
            // Native radios: one tab stop, arrow keys move the choice.
            <label className="location-correction-option" data-checked={picked === option.key} key={option.key}>
              <input checked={picked === option.key} className="location-correction-radio" disabled={busy} name={`location-correction-place-${place.id}`}
                onChange={() => setPicked(option.key)} type="radio" value={option.key} />
              <DayframeIcon glyph={option.glyph} size={18} />
              <span><b>{option.name}</b><small>{option.note}</small></span>
            </label>
          ))}
        </div>
        <p className="location-correction-hint">Nearby suggestions come from Apple Maps, so they show on your iPhone. The web shows places you saved.</p>
        {open ? null : (
          <>
            <span className="location-correction-label" id="location-correction-times">Times</span>
            <div aria-labelledby="location-correction-times" className="location-correction-times" role="group">
              <label className="location-correction-time"><span>Start</span>
                <input disabled={busy} onChange={(event) => setStart(event.target.value)} type="time" value={start} />
              </label>
              <label className="location-correction-time"><span>End</span>
                <input disabled={busy} onChange={(event) => setEnd(event.target.value)} type="time" value={end} />
              </label>
            </div>
          </>
        )}
        {error ? <p className="location-correction-error" role="alert">{error}</p> : null}
      </div>
    </ModalDialog>
  );
}
