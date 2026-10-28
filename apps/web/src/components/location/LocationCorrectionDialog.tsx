"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_LEG_MODE_ICONS,
  LEG_MODE_LABEL,
  type ClockFormat,
  type TimelineCorrectionRequest,
  type TimelineItemEvidenceDto,
  type TimelinePlace,
  type TimelineTrip,
  type TripLeg,
  type TripLegMode
} from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { Button, ModalDialog } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { formatDuration, formatTime } from "@/lib/format";

// The map is client-only (MapLibre), loaded when a dialog opens with the map first (step 15: the map first on every sheet).
const LocationEvidenceMap = dynamic(() => import("@/components/location/LocationEvidenceMap").then((module) => module.LocationEvidenceMap), { ssr: false });

/**
 * Correcting the location timeline on the web (location v4 step 13, mock-up #web-list inspector):
 * a place's place and times, or a leg's mode, through `POST /api/timeline/corrections` (step 11).
 * Opens as the web's standard dialog (a bottom sheet at phone width). Nothing needs approving: what
 * the person leaves alone stays as Dayframe made it.
 */
export type LocationCorrectionTarget =
  /** `joinsTrips`: a trip comes into the place and one leaves it, so "I wasn't here" can join them (step 12 part 4). */
  | { kind: "place"; place: TimelinePlace; label: string; joinsTrips?: boolean }
  | { kind: "leg"; tripId: string; leg: TripLeg; index: number; count: number }
  /** a trip's own dialog (its map, legs, "I didn't leave", "This wasn't a trip"). */
  | { kind: "trip"; trip: TimelineTrip; route: string };

/**
 * An item's open "?", asked at the top of its dialog (owner item A). `onAnswer(true)` is its Yes; with an
 * activity it is "Logs as" for a place that asks (the server refuses log_place while a place has an open
 * question, so the answer logs it, with that activity). An answer that saves at once returns a promise of
 * its error (null when saved): the dialog stays open on a failure and says why. One held for Undo returns nothing.
 */
export type CorrectionQuestion = {
  text: string; yesLabel: string | null; noLabel: string;
  onAnswer: (yes: boolean, categoryId?: string) => void | Promise<string | null>;
};

/** An activity a place can log as ("Logs as"). */
export type CorrectionActivity = { id: string; name: string };

/**
 * The map for a place or trip (location v4 step 15: the map first on every sheet), read once per open
 * dialog from `GET /api/timeline/items/{id}/evidence`. Null while loading; "unavailable" when it can't be read.
 */
function useItemEvidence(item: { id: string; kind: "place" | "trip"; startedAt: string } | null) {
  const [evidence, setEvidence] = useState<{ key: string; value: TimelineItemEvidenceDto | "unavailable" } | null>(null);
  const key = item ? `${item.kind}:${item.id}:${item.startedAt}` : null;
  useEffect(() => {
    if (!item || !key) return;
    const controller = new AbortController();
    clientFetch(`/api/timeline/items/${encodeURIComponent(item.id)}/evidence?kind=${item.kind}&startedAt=${encodeURIComponent(item.startedAt)}`,
      { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? await response.json() as TimelineItemEvidenceDto : "unavailable" as const)
      .catch(() => "unavailable" as const)
      .then((value) => { if (!controller.signal.aborted) setEvidence({ key, value }); });
    return () => controller.abort();
    // The item's identity is its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return evidence && evidence.key === key ? evidence.value : null;
}

function EvidenceMap({ evidence }: { evidence: TimelineItemEvidenceDto | "unavailable" | null }) {
  if (evidence === null) return <p className="location-correction-map is-loading">Loading the map…</p>;
  if (evidence === "unavailable") return <p className="location-correction-map is-loading">The map isn’t available right now.</p>;
  // The map reads only the segment and its geometry; a timeline item may have no Review item or event.
  return <div className="location-correction-map"><LocationEvidenceMap evidence={{ ...evidence, reviewItemId: evidence.reviewItemId ?? "", eventId: evidence.eventId ?? "" }} /></div>;
}

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
  // A time the clocks repeat has two instants: the one nearer the time it replaces (Codex r2 on #567). Clock
  // changes are 30 minutes to 2 hours, so the instants up to 2 hours either side, a quarter-hour apart, are
  // every one that can show this time (Codex r3 on #567).
  const same = (candidate: Date) => candidate.getHours() === hours && candidate.getMinutes() === minutes;
  const instants = Array.from({ length: 17 }, (_, step) => new Date(date.getTime() + (step - 8) * 15 * 60_000)).filter(same);
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
  activities = [],
  clock,
  onClose,
  onCorrected,
  places,
  question = null,
  target: initialTarget
}: {
  /**
   * Owner item A): the item's open "?", asked at the top now that a row or a Grid item opens
   * this dialog directly. An answer closes the dialog.
   */
  question?: CorrectionQuestion | null;
  /** the activities a place can log as. */
  activities?: readonly CorrectionActivity[];
  clock: ClockFormat;
  onClose: () => void;
  onCorrected: () => Promise<void> | void;
  places: readonly CorrectionPlace[];
  target: LocationCorrectionTarget;
}) {
  // A trip's leg opens inside its dialog, with a way back (the iPhone sheet's push, as a swap here).
  const [legOfTrip, setLegOfTrip] = useState<number | null>(null);
  const target: Exclude<LocationCorrectionTarget, { kind: "trip" }> | Extract<LocationCorrectionTarget, { kind: "trip" }> =
    initialTarget.kind === "trip" && legOfTrip !== null
      ? { kind: "leg", tripId: initialTarget.trip.id, leg: initialTarget.trip.legs[legOfTrip], index: legOfTrip, count: initialTarget.trip.legs.length }
      : initialTarget;
  const evidence = useItemEvidence(initialTarget.kind === "place" ? { id: initialTarget.place.id, kind: "place", startedAt: initialTarget.place.startedAt }
    : initialTarget.kind === "trip" ? { id: initialTarget.trip.id, kind: "trip", startedAt: initialTarget.trip.startedAt } : null);
  const [logAs, setLogAs] = useState<string | null>(null);
  // Closed (or replaced) while saving: what was in flight stops at its next step, so nothing is sent for a
  // dialog that is gone (Codex r1 on #609).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // "Save this place" made the place but couldn't set the visit to it: a retry sets it, and makes no second place.
  const [createdPlaceId, setCreatedPlaceId] = useState<string | null>(null);
  const [newPlaceName, setNewPlaceName] = useState("");
  const [confirmingTrip, setConfirmingTrip] = useState<"merge" | "delete" | null>(null);
  // Owner item N): saved places nearest the visit first, as far as the map knows; places further
  // than 2 km (or not near at all) wait behind "More places".
  const [morePlaces, setMorePlaces] = useState(false);
  // Only with a visit centre: without one the map can't say what's near, so every place shows.
  const distances = evidence && evidence !== "unavailable" && evidence.map.centre
    ? new Map(evidence.map.nearbySavedPlaces.map((saved) => [saved.id, saved.distanceMeters] as const)) : null;
  const currentPlaceId = initialTarget.kind === "place" ? initialTarget.place.placeId : null;
  const isNear = (id: string) => (distances?.get(id) ?? Infinity) <= 2_000 || id === currentPlaceId;
  const sortedPlaces = distances ? [...places].sort((a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity)) : places;
  const shownPlaces = distances && !morePlaces ? sortedPlaces.filter((option) => isNear(option.id)) : sortedPlaces;
  const hiddenPlaces = distances && !morePlaces ? sortedPlaces.filter((option) => !isNear(option.id)) : [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "I wasn't here", asked once in place before the place comes off the day.
  const [confirmingRemove, setConfirmingRemove] = useState(false);
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
    if (target.kind === "trip") return [];
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
    // "Logs as" fills the place's time your blocks don't cover with that activity; a place that asks is
    // logged by answering its "?" instead (see `apply`).
    if (logAs && !question) out.push({ kind: "log_place", subject: "place", itemId: place.id, categoryId: logAs });
    return out;
  }

  async function apply() {
    const pending = corrections();
    if (typeof pending === "string") {
      setError(pending);
      return;
    }
    const answerWith = target.kind === "place" && logAs && question ? logAs : null;
    if (!pending.length && !answerWith) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    let savedAny = false;
    for (const correction of pending) {
      const failure = await sendCorrection(correction).catch(() => "Couldn't save that. Check your connection and try again.");
      if (!alive.current) return;
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
    // A place that asks is logged by its "?": the answer's log, with the picked activity (Codex r1 on #609).
    if (answerWith && question) {
      const failure = await question.onAnswer(true, answerWith);
      if (!alive.current) return;
      if (failure) {
        if (savedAny) await onCorrected();
        setBusy(false);
        setError(failure);
        return;
      }
    }
    if (savedAny) await onCorrected();
    if (!alive.current) return;
    setBusy(false);
    onClose();
  }

  /** The "?" at the top: held for Undo, it closes at once; saved at once, it closes only once it saved. */
  async function answer(yes: boolean) {
    if (!question) return;
    const result = question.onAnswer(yes);
    if (result) {
      setBusy(true);
      setError(null);
      const failure = await result;
      if (!alive.current) return;
      setBusy(false);
      if (failure) {
        setError(failure);
        return;
      }
    }
    onClose();
  }

  /** A trip's leg, opened inside its dialog: its own mode is the one chosen and the one saved. */
  function openLeg(index: number) {
    if (initialTarget.kind !== "trip") return;
    const legMode = initialTarget.trip.legs[index].mode;
    setMode(legMode);
    setSaved((current) => ({ ...current, mode: legMode }));
    setError(null);
    setLegOfTrip(index);
  }

  /** A trip's "I didn't leave" (one stay) or "This wasn't a trip" (off your day), confirmed in place first. */
  async function fixTrip(kind: "merge" | "delete") {
    if (initialTarget.kind !== "trip") return;
    setBusy(true);
    setError(null);
    const failure = await sendCorrection(kind === "merge" ? { kind: "merge", subject: "trip", itemId: initialTarget.trip.id }
      : { kind: "delete", subject: "trip", itemId: initialTarget.trip.id })
      .catch(() => "Couldn't save that. Check your connection and try again.");
    if (!alive.current) return;
    if (failure) {
      setBusy(false);
      setError(failure);
      return;
    }
    await onCorrected();
    if (!alive.current) return;
    setBusy(false);
    onClose();
  }

  /** "Save this place": a saved place where the map puts the visit, under the name typed, and the visit set to it. */
  async function saveThisPlace() {
    if (target.kind !== "place" || !evidence || evidence === "unavailable" || !evidence.map.centre) return;
    const name = newPlaceName.trim();
    if (!name) {
      setError("Give the place a name.");
      return;
    }
    setBusy(true);
    setError(null);
    let placeId = createdPlaceId;
    if (!placeId) {
      const [longitude, latitude] = evidence.map.centre.coordinates;
      const radiusMeters = Math.round(Math.min(250, Math.max(75, evidence.map.stayRadiusMeters ?? 100)));
      const response = await clientFetch("/api/places", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, latitude, longitude, radiusMeters }) }).catch(() => null);
      const created = response?.ok ? await response.json().catch(() => null) as { place?: { id?: string } } | null : null;
      if (!alive.current) return;
      placeId = created?.place?.id ?? null;
      if (!placeId) {
        setBusy(false);
        setError("The place wasn't saved. Saving a place needs a connection.");
        return;
      }
      setCreatedPlaceId(placeId);
    }
    const failure = await sendCorrection({ kind: "place", subject: "place", itemId: target.place.id, placeId, learnedPlaceId: null })
      .catch(() => "Couldn't save that. Check your connection and try again.");
    if (!alive.current) return;
    await onCorrected();
    if (!alive.current) return;
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    onClose();
  }

  /** "I wasn't here": the place leaves the day and the trips either side become one (step 12 part 4). */
  async function removePlace() {
    if (target.kind !== "place") return;
    setBusy(true);
    setError(null);
    const failure = await sendCorrection({ kind: "delete", subject: "place", itemId: target.place.id })
      .catch(() => "Couldn't save that. Check your connection and try again.");
    if (!alive.current) return;
    if (failure) {
      setBusy(false);
      setError(failure);
      return;
    }
    await onCorrected();
    if (!alive.current) return;
    setBusy(false);
    onClose();
  }

  const questionCard = question && legOfTrip === null ? (
    <div className="location-correction-question" role="group" aria-label={question.text}>
      <b>{question.text}</b>
      <div className="location-correction-question-answers">
        {question.yesLabel ? (
          // Card D item 9: the answer is the neutral dark pill; coral stays for Play/Stop and live recording.
          <button className="ui-button timeline-check-log is-compact" disabled={busy} onClick={() => void answer(true)} type="button">{question.yesLabel}</button>
        ) : null}
        {/* The owner's compact pill for inline answers (28 Oct 2026). */}
        <button className="ui-button ui-button-secondary is-compact" disabled={busy} onClick={() => void answer(false)} type="button">{question.noLabel}</button>
      </div>
    </div>
  ) : null;

  const pendingNow = corrections();
  const changed = typeof pendingNow === "string" || pendingNow.length > 0 || Boolean(newPlaceName.trim()) || Boolean(logAs && question);
  const footer = (
    <>
      <Button disabled={busy} onClick={onClose}>Cancel</Button>
      {/* Owner item O): Done looks secondary until something has changed. */}
      <Button disabled={busy} onClick={() => void apply()} variant={changed ? "primary" : undefined}>Done</Button>
    </>
  );

  if (target.kind === "trip") {
    const { trip } = target;
    return (
      <ModalDialog busy={busy} description={`${formatTime(trip.startedAt, clock)}–${formatTime(trip.stoppedAt, clock)}`}
        footer={<Button disabled={busy} onClick={onClose}>Done</Button>} onClose={onClose} size="compact" title={target.route}>
        <div className="location-correction">
          {questionCard}
          <EvidenceMap evidence={evidence} />
          <span className="location-correction-label" id="location-correction-legs">Legs</span>
          <div aria-labelledby="location-correction-legs" className="location-correction-legs" role="group">
            {trip.legs.map((leg, index) => (
              <button className="location-correction-leg" disabled={busy} key={`${leg.startedAt}-${index}`} onClick={() => openLeg(index)} type="button">
                <DayframeIcon glyph={DAYFRAME_LEG_MODE_ICONS[leg.mode]} size={18} />
                <span><b>{LEG_MODE_LABEL[leg.mode]}{leg.confidence === "unsure" ? "?" : ""}</b>
                  <small>{formatTime(leg.startedAt, clock)}–{formatTime(leg.stoppedAt, clock)} · {formatDuration(Math.max(0, Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000)))}</small></span>
                <DayframeIcon glyph="chevron-right" size={16} />
              </button>
            ))}
          </div>
          <span className="location-correction-label" id="location-correction-trip-shape">Fix the shape</span>
          <div aria-labelledby="location-correction-trip-shape" className="location-correction-shape" role="group">
            {confirmingTrip ? (
              <div className="location-correction-confirm">
                <p>{confirmingTrip === "merge" ? "Make this one stay? The places either side join into one." : "Take this trip off your day?"}</p>
                <div className="location-correction-confirm-actions">
                  <Button disabled={busy} onClick={() => void fixTrip(confirmingTrip)} variant="danger">
                    {confirmingTrip === "merge" ? "Make it one stay" : "Take it off your day"}
                  </Button>
                  <Button disabled={busy} onClick={() => setConfirmingTrip(null)}>Keep it</Button>
                </div>
              </div>
            ) : (
              <>
                <Button disabled={busy} onClick={() => setConfirmingTrip("merge")}>I didn&apos;t leave</Button>
                <Button disabled={busy} onClick={() => setConfirmingTrip("delete")}>This wasn&apos;t a trip</Button>
              </>
            )}
          </div>
          {error ? <p className="location-correction-error" role="alert">{error}</p> : null}
        </div>
      </ModalDialog>
    );
  }

  if (target.kind === "leg") {
    const { leg } = target;
    const minutes = Math.max(0, Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000));
    return (
      <ModalDialog busy={busy} description={`Leg ${target.index + 1} of ${target.count} · ${formatTime(leg.startedAt, clock)}–${formatTime(leg.stoppedAt, clock)}`}
        footer={footer} onClose={onClose} size="compact" title={`${LEG_MODE_LABEL[mode]} · ${formatDuration(minutes)}`}>
        <div className="location-correction">
          {legOfTrip !== null ? (
            <button className="location-correction-back" disabled={busy} onClick={() => { setLegOfTrip(null); setError(null); }} type="button">
              <DayframeIcon glyph="arrow-left" size={16} /> All legs
            </button>
          ) : null}
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
        {questionCard}
        <EvidenceMap evidence={evidence} />
        <span className="location-correction-label" id="location-correction-place">Where were you?</span>
        <div aria-labelledby="location-correction-place" className="location-correction-options" role="radiogroup">
          {[
            ...(place.learnedPlaceId && !place.placeId
              ? [{ key: original, glyph: DAYFRAME_APP_ICONS.places, name: place.name ?? "Learned place", note: "Learned place" }] : []),
            ...shownPlaces.map((option) => ({ key: `saved:${option.id}`, name: option.name,
              note: distances?.has(option.id) ? `Saved place · ${formatMetres(distances.get(option.id)!)} away` : "Saved place",
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
        {hiddenPlaces.length ? (
          <button className="location-correction-more" disabled={busy} onClick={() => setMorePlaces(true)} type="button">
            More places ({hiddenPlaces.length})
          </button>
        ) : null}
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
        {!place.blockIds.length ? (
          <>
            <span className="location-correction-label" id="location-correction-logs-as">Logs as</span>
            <div aria-labelledby="location-correction-logs-as" className="location-correction-logs-as" role="radiogroup">
              {[{ id: null as string | null, name: "Don't log" }, ...activities.slice(0, 8)].map((activity) => (
                <button aria-checked={logAs === activity.id} className="location-correction-pill" disabled={busy} key={activity.id ?? "none"}
                  onClick={() => setLogAs(activity.id)} role="radio" type="button">{activity.name}</button>
              ))}
            </div>
          </>
        ) : null}
        {!place.placeId ? (
          <>
            <span className="location-correction-label" id="location-correction-save">Save this place</span>
            <div aria-labelledby="location-correction-save" className="location-correction-save" role="group">
              <input aria-label="Name for this place" disabled={busy} onChange={(event) => setNewPlaceName(event.target.value)}
                placeholder="Name it, for example Pret" type="text" value={newPlaceName} />
              <Button disabled={busy || !evidence || evidence === "unavailable" || !evidence.map.centre} onClick={() => void saveThisPlace()}>Save place</Button>
            </div>
          </>
        ) : null}
        {!open && target.joinsTrips ? (
          <>
            <span className="location-correction-label" id="location-correction-shape">Fix the shape</span>
            <div aria-labelledby="location-correction-shape" className="location-correction-shape" role="group">
              {confirmingRemove ? (
                <div className="location-correction-confirm">
                  <p>Take this place off your day? The trips either side become one trip.</p>
                  <div className="location-correction-confirm-actions">
                    <Button disabled={busy} onClick={() => void removePlace()} variant="danger">Take it off your day</Button>
                    <Button disabled={busy} onClick={() => setConfirmingRemove(false)}>Keep it</Button>
                  </div>
                </div>
              ) : (
                <Button disabled={busy} onClick={() => setConfirmingRemove(true)}>I wasn&apos;t here</Button>
              )}
            </div>
          </>
        ) : null}
        {error ? <p className="location-correction-error" role="alert">{error}</p> : null}
      </div>
    </ModalDialog>
  );
}

/** "120 m", "1.4 km". */
function formatMetres(metres: number) {
  return metres < 1_000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1_000).toFixed(1)} km`;
}
