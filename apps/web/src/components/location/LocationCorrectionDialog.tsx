"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_LEG_MODE_ICONS,
  LEG_MODE_LABEL,
  evidenceSheetCaption,
  type ClockFormat,
  type TimelineCorrectionRequest,
  type TimelineItemEvidenceDto,
  type TimelinePlace,
  type TimelineTrip,
  type TripLeg,
  type TripLegMode
} from "@dayframe/shared";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import { ActivityChipFace } from "@/components/blocks/ActivityChipGroup";
import { blockStyle } from "@/lib/block-style";
import { Button, ModalDialog } from "@/components/ui/Primitives";
import { clientFetch } from "@/lib/client-auth-fetch";
import { formatDuration, formatTime } from "@/lib/format";
import { useMapProvider } from "@/components/location/PlaceSheetMap";
import { TimeField } from "@/components/ui/TimeField";

// The map is client-only (MapLibre), loaded when a dialog opens with the map first (step 15: the map first on every sheet).
// While its chunk loads, an empty frame of the map's own size holds the sheet still (Codex r1 on #626).
export function EvidenceMapChunkLoading() {
  return <div aria-hidden className="location-evidence-frame" data-testid="evidence-map-loading" />;
}
// Apple MapKit JS when the server has its key, else MapLibre (UI review, owner 29 Oct 2026).
const PlaceSheetMap = dynamic(() => import("@/components/location/PlaceSheetMap").then((module) => module.PlaceSheetMap),
  { loading: EvidenceMapChunkLoading, ssr: false });
// Apple's nearby places, with MapKit JS only (UI review, owner 29 Oct 2026; PRD D19 A7).
const NearbyPlaces = dynamic(() => import("@/components/location/NearbyPlaces").then((module) => module.NearbyPlaces), { ssr: false });

/**
 * Correcting the location timeline on the web (location v4 step 13, mock-up #web-list inspector):
 * a place's place and times, or a leg's mode, through `POST /api/timeline/corrections` (step 11).
 * Opens as the web's standard dialog (a bottom sheet at phone width). Nothing needs approving: what
 * the person leaves alone stays as Dayframe made it.
 *
 * One layout for every dialog, as the iPhone's sheets (owner feedback, 29 Oct 2026; brand guide "Place and trip
 * sheet"): the title and times; the "?" (one Yes); the map (the visit's area or the trip's route, at most "Based on
 * N readings"); "Where were you?" (places: saved places nearest first; Apple's nearby places are the iPhone's);
 * "Logs as" (compact activity chips; none picked is "don't log"); the times; then the corrections.
 */

/** The dialog's sections, top to bottom (`data-section`); a dialog shows the ones that apply, in this order. */
export const DIALOG_SECTION_ORDER = ["question", "map", "where", "logs-as", "times", "corrections"] as const;
export type LocationCorrectionTarget =
  /** `joinsTrips`: a trip comes into the place and one leaves it, so "I wasn't here" can join them (step 12 part 4). */
  | { kind: "place"; place: TimelinePlace; label: string; joinsTrips?: boolean }
  | { kind: "leg"; tripId: string; leg: TripLeg; index: number; count: number }
  /** a trip's own dialog (its map, legs, "I didn't leave", "This wasn't a trip"). */
  | { kind: "trip"; trip: TimelineTrip; route: string };

/**
 * An item's open "?", asked at the top of its dialog (owner item A). An answer that saves at once returns a
 * promise of its error (null when saved): the dialog stays open on a failure and says why. One held for Undo
 * returns nothing. "Logs as" is never an answer: it is log_place, which closes the place's open "?" itself as
 * their own Not now does, and logs only the time your blocks don't cover (Codex r2 on #609).
 */
export type CorrectionQuestion = {
  text: string; yesLabel: string | null; noLabel: string;
  onAnswer: (yes: boolean) => void | Promise<string | null>;
};

/** An activity a place can log as ("Logs as"). */
export type CorrectionActivity = { id: string; name: string; color?: string | null; icon?: string | null };

/**
 * The map for a place or trip (location v4 step 15: the map first on every sheet), read once per open
 * dialog from `GET /api/timeline/items/{id}/evidence`. Null while loading; "unavailable" when it can't be read.
 */
function useItemEvidence(item: { id: string; kind: "place" | "trip"; startedAt: string; stoppedAt: string | null } | null) {
  const [evidence, setEvidence] = useState<{ key: string; value: TimelineItemEvidenceDto | "unavailable" } | null>(null);
  // Its whole span: a refresh that moves either end reads the map again (Codex r3 on #609).
  const key = item ? `${item.kind}:${item.id}:${item.startedAt}:${item.stoppedAt ?? ""}` : null;
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

/**
 * A trip's leg on the trip's map (glitch fix 5): the trip's readings within the leg's times, as its route, so the
 * one map swaps to the leg in place. A leg with fewer than two readings (underground, no signal) shows the trip.
 */
export function legEvidence(evidence: TimelineItemEvidenceDto, leg: Pick<TripLeg, "startedAt" | "stoppedAt">): TimelineItemEvidenceDto {
  const from = Date.parse(leg.startedAt);
  const to = Date.parse(leg.stoppedAt);
  const samples = evidence.map.acceptedSamples
    .filter((sample) => { const at = Date.parse(sample.occurredAt); return at >= from && at <= to; })
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  if (samples.length < 2) return evidence;
  return {
    ...evidence,
    segment: { ...evidence.segment, evidenceCount: samples.length },
    map: {
      ...evidence.map,
      route: { type: "LineString", coordinates: samples.map((sample) => sample.point.coordinates) },
      straightLineFallback: null,
      acceptedSamples: samples
    }
  };
}

function EvidenceMap({ evidence, knownPlace, leg = null }: {
  evidence: TimelineItemEvidenceDto | "unavailable" | null;
  knownPlace: boolean;
  /** A trip's open leg: the same map, drawn for the leg. */
  leg?: Pick<TripLeg, "startedAt" | "stoppedAt"> | null;
}) {
  // One evidence object per content (glitch fix 1): a re-render (typing, a search, the clock) hands the map the
  // same object, so it never rebuilds.
  const legStartedAt = leg?.startedAt ?? null;
  const legStoppedAt = leg?.stoppedAt ?? null;
  const mapEvidence = useMemo(() => {
    if (!evidence || evidence === "unavailable") return null;
    const shown = legStartedAt && legStoppedAt ? legEvidence(evidence, { startedAt: legStartedAt, stoppedAt: legStoppedAt }) : evidence;
    return { ...shown, reviewItemId: shown.reviewItemId ?? "", eventId: shown.eventId ?? "" };
  }, [evidence, legStartedAt, legStoppedAt]);
  if (evidence === null) return <p className="location-correction-map is-loading" data-section="map">Loading the map…</p>;
  if (!mapEvidence) return <p className="location-correction-map is-loading" data-section="map">The map isn’t available right now.</p>;
  // The map reads only the segment and its geometry; a timeline item may have no Review item or event. Only the
  // visit's own area (or the trip's route), and one plain line at most: never the silences (owner, 29 Oct 2026).
  return (
    <div className="location-correction-map" data-section="map">
      <PlaceSheetMap caption={evidenceSheetCaption(mapEvidence, { knownPlace })} evidence={mapEvidence} />
    </div>
  );
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
  const body = await response.json().catch(() => null) as { error?: string; logged?: { resolvedReviewItemIds?: unknown } } | null;
  if (response.ok) {
    const resolved = body?.logged?.resolvedReviewItemIds;
    return { failure: null, resolvedReviewItemIds: Array.isArray(resolved) ? resolved.filter((id): id is string => typeof id === "string") : [] };
  }
  return { failure: body?.error ?? "Couldn't save that. Try again.", resolvedReviewItemIds: [] };
}

export function LocationCorrectionDialog({
  activities = [],
  clock,
  onClose,
  onCorrected,
  onReceiptAfterClose,
  onResolved,
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
  /** Review items a saved correction resolved (Logs as closes the place's open "?"): the decisions owner settles them. */
  onResolved?: (reviewItemIds: readonly string[]) => void;
  /**
   * A correction saved after the dialog has gone (closed or left while it was saving): the owner that outlives it
   * reads the day again, once, so its blocks show (Codex r1 on #617). `onCorrected` covers every save while it is open.
   */
  onReceiptAfterClose?: () => void;
  places: readonly CorrectionPlace[];
  target: LocationCorrectionTarget;
}) {
  // A trip's leg opens inside its dialog, with a way back (the iPhone sheet's push, as a swap here).
  // The leg is kept by its span, so a refresh that changes the trip's legs finds it again, or (gone, or the legs
  // merged or split around it) goes back to the trip (Codex r3 on #609).
  const [openedLeg, setOpenedLeg] = useState<{ startedAt: string; stoppedAt: string } | null>(null);
  const legIndex = openedLeg && initialTarget.kind === "trip"
    ? initialTarget.trip.legs.findIndex((leg) => leg.startedAt === openedLeg.startedAt && leg.stoppedAt === openedLeg.stoppedAt) : -1;
  if (openedLeg && legIndex < 0) setOpenedLeg(null);
  const legOfTrip = openedLeg && legIndex >= 0 ? legIndex : null;
  const setLegOfTrip = (index: number | null) => setOpenedLeg(index === null || initialTarget.kind !== "trip" ? null
    : { startedAt: initialTarget.trip.legs[index].startedAt, stoppedAt: initialTarget.trip.legs[index].stoppedAt });
  const target: Exclude<LocationCorrectionTarget, { kind: "trip" }> | Extract<LocationCorrectionTarget, { kind: "trip" }> =
    initialTarget.kind === "trip" && legOfTrip !== null
      ? { kind: "leg", tripId: initialTarget.trip.id, leg: initialTarget.trip.legs[legOfTrip], index: legOfTrip, count: initialTarget.trip.legs.length }
      : initialTarget;
  const evidence = useItemEvidence(initialTarget.kind === "place"
    ? { id: initialTarget.place.id, kind: "place", startedAt: initialTarget.place.startedAt, stoppedAt: initialTarget.place.stoppedAt }
    : initialTarget.kind === "trip" ? { id: initialTarget.trip.id, kind: "trip", startedAt: initialTarget.trip.startedAt, stoppedAt: initialTarget.trip.stoppedAt } : null);
  // One id per logical correction (Codex r3 on #609): made when it is first sent and reused on each retry, so a
  // retry after a lost reply gets the saved receipt back instead of a refusal.
  const correctionIds = useRef(new Map<string, string>());
  const send = (correction: TimelineCorrectionRequest) => {
    const signature = JSON.stringify(correction);
    let id = correctionIds.current.get(signature);
    if (!id) {
      id = crypto.randomUUID();
      correctionIds.current.set(signature, id);
    }
    // Saved, it is done: the same change made again later is a new correction with a new id.
    return sendCorrection({ ...correction, clientCorrectionId: id }).then(({ failure, resolvedReviewItemIds }) => {
      if (!failure) {
        correctionIds.current.delete(signature);
        unrefreshed.current = true;
      }
      // The questions the server closed with it: settled at once, even if the dialog has gone (Codex r6 on #609).
      if (resolvedReviewItemIds.length) onResolved?.(resolvedReviewItemIds);
      // Gone meanwhile: what saved (this or an earlier step of the same Done) is read again by the owner that
      // outlives the dialog, once (Codex r1 on #617).
      if (!alive.current && unrefreshed.current) {
        unrefreshed.current = false;
        onReceiptAfterClose?.();
      }
      return failure;
    });
  };
  // Saves not yet followed by a read of the day (onCorrected while open, onReceiptAfterClose once gone).
  const unrefreshed = useRef(false);
  const corrected = () => {
    unrefreshed.current = false;
    return onCorrected();
  };
  const [logAs, setLogAs] = useState<string | null>(null);
  // The Logs as chips, so "Don't log" (which goes as it clears the pick) hands focus to the chip it cleared (Codex r5 on #620).
  const logAsChips = useRef(new Map<string, HTMLButtonElement>());
  // Closed (or replaced) while saving: what was in flight stops at its next step, so nothing is sent for a
  // dialog that is gone (Codex r1 on #609).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // "Save this place" made the place but couldn't set the visit to it: a retry sets it, and makes no second place.
  const [createdPlaceId, setCreatedPlaceId] = useState<string | null>(null);
  // Whether a creation was sent whose outcome isn't known, and the places that existed when the dialog opened.
  // The creation sent whose outcome isn't known (its reply was lost): its own name and spot, kept until a lookup
  // that worked finds the place or confirms it isn't there (Codex r8 on #609).
  const pendingCreation = useRef<{ name: string; latitude: number; longitude: number } | null>(null);
  // Its name, for rendering (the footer's label and recovery read state, never the ref, during render).
  const [pendingCreationName, setPendingCreationName] = useState<string | null>(null);
  const openingPlaceIds = useRef(new Set(places.map((option) => option.id)));
  const [newPlaceName, setNewPlaceName] = useState("");
  const newPlaceNameRef = useRef<HTMLInputElement | null>(null);
  // Asked only where Apple's nearby places could show: an unknown place whose evidence has a centre.
  const [mapProvider, setMapProvider] = useMapProvider(target.kind === "place" && !target.place.placeId
    && Boolean(evidence && evidence !== "unavailable" && evidence.map.centre));
  const [confirmingTrip, setConfirmingTrip] = useState<"merge" | "delete" | null>(null);
  // Saved places nearest the visit first, as far as the map knows (the place dialog lists at most two within 1 km).
  // Only with a visit centre: without one the map can't say what's near, so every place shows.
  const distances = evidence && evidence !== "unavailable" && evidence.map.centre
    ? new Map(evidence.map.nearbySavedPlaces.map((saved) => [saved.id, saved.distanceMeters] as const)) : null;
  const currentPlaceId = initialTarget.kind === "place" ? initialTarget.place.placeId : null;
  const sortedPlaces = distances ? [...places].sort((a, b) => (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity)) : places;
  const [busy, setBusy] = useState(false);
  // Proposed (UI review round 2, owner 30 Oct 2026): one search for Apple's places and the saved ones, and the rest
  // of the dialog behind "More options".
  const [query, setQuery] = useState("");
  const [moreOptions, setMoreOptions] = useState(false);
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
  // The place as the newest data has it (a refresh moved its times or set its place): once nothing is saving,
  // its fields and what "changed" compares with start again from it; its map follows by its own key (Codex r2 on #609).
  const placeVersion = target.kind === "place"
    ? `${target.place.startedAt}|${target.place.stoppedAt ?? ""}|${target.place.placeId ?? ""}|${target.place.learnedPlaceId ?? ""}` : "";
  const [seenPlaceVersion, setSeenPlaceVersion] = useState(placeVersion);
  if (placeVersion !== seenPlaceVersion && !busy && target.kind === "place") {
    setSeenPlaceVersion(placeVersion);
    // Only fields the person hasn't edited follow the new data: a save that stopped part-way keeps the rest of the
    // draft for the retry (Codex r2 on #636).
    if (picked === saved.picked) setPicked(original);
    if (start === timeValue(saved.startedAt)) setStart(timeValue(target.place.startedAt));
    if (end === (saved.stoppedAt ? timeValue(saved.stoppedAt) : "")) setEnd(target.place.stoppedAt ? timeValue(target.place.stoppedAt) : "");
    setSaved((current) => ({ ...current, picked: original, startedAt: target.place.startedAt, stoppedAt: target.place.stoppedAt }));
  }
  // The open leg as the newest data has it: a refresh that changed its mode moves the baseline to that mode, and
  // the choice with it unless the person already picked another here (theirs stays, compared with the new
  // baseline; Codex r4 on #609).
  const legMode = target.kind === "leg" ? target.leg.mode : null;
  const [seenLegMode, setSeenLegMode] = useState(legMode);
  if (legMode !== seenLegMode && !busy) {
    setSeenLegMode(legMode);
    if (legMode && seenLegMode) {
      if (mode === saved.mode) setMode(legMode);
      setSaved((current) => ({ ...current, mode: legMode }));
    }
  }

  function corrections(choice: string = picked): TimelineCorrectionRequest[] | string {
    // Only what changed is sent: an untouched leg, place or time is left as it is.
    if (target.kind === "trip") return [];
    if (target.kind === "leg") {
      return mode === saved.mode ? [] : [{
        kind: "leg_mode", subject: "leg", itemId: target.tripId, legStartedAt: target.leg.startedAt, legStoppedAt: target.leg.stoppedAt, mode
      }];
    }
    const { place } = target;
    const out: TimelineCorrectionRequest[] = [];
    if (choice !== saved.picked) {
      out.push({ kind: "place", subject: "place", itemId: place.id,
        placeId: choice.startsWith("saved:") ? choice.slice(6) : null,
        learnedPlaceId: choice.startsWith("learned:") ? choice.slice(8) : null });
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
    // "Logs as" fills the place's time your blocks don't cover with that activity, after any other change, so it
    // reads the corrected place; the server closes the place's open "?" with it.
    if (logAs) out.push({ kind: "log_place", subject: "place", itemId: place.id, categoryId: logAs });
    return out;
  }

  /** Saves what changed; `choice` (Proposed: a tapped place) answers with that place, with any other edits. */
  async function apply(choice: string = picked) {
    if (choice !== picked) setPicked(choice);
    const pending = corrections(choice);
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
      const failure = await send(correction).catch(() => "Couldn't save that. Check your connection and try again.");
      if (!alive.current) return;
      if (failure) {
        // What did save is the new starting point, and the List shows it.
        if (savedAny) await corrected();
        setBusy(false);
        setError(failure);
        return;
      }
      savedAny = true;
      setSaved((current) => correction.kind === "place" ? { ...current, picked: choice }
        : correction.kind === "times" ? { ...current, startedAt: correction.startedAt, stoppedAt: correction.stoppedAt }
          : correction.kind === "leg_mode" ? { ...current, mode: correction.mode } : current);
    }
    await corrected();
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
    const failure = await send(kind === "merge" ? { kind: "merge", subject: "trip", itemId: initialTarget.trip.id }
      : { kind: "delete", subject: "trip", itemId: initialTarget.trip.id })
      .catch(() => "Couldn't save that. Check your connection and try again.");
    if (!alive.current) return;
    if (failure) {
      setBusy(false);
      setError(failure);
      return;
    }
    await corrected();
    if (!alive.current) return;
    setBusy(false);
    onClose();
  }

  /** "Save this place": a saved place where the map puts the visit, under the name typed, and the visit set to it. */
  async function saveThisPlace(chosenName?: string) {
    if (target.kind !== "place" || !evidence || evidence === "unavailable" || !evidence.map.centre) return;
    const name = (chosenName ?? newPlaceName).trim();
    if (!name) {
      setError("Give the place a name.");
      return;
    }
    // The other edits go with it (Codex r1 on #636): check them before anything is created.
    const others = corrections();
    if (typeof others === "string") {
      setError(others);
      return;
    }
    setBusy(true);
    setError(null);
    let placeId = createdPlaceId;
    const [longitude, latitude] = evidence.map.centre.coordinates;
    // A creation whose reply was lost may have saved the place: before trying again, look for it — by the name
    // and spot that creation sent (not what the fields say now), among places this dialog didn't open with — and use
    // it, even if the name was edited since (Codex r7, r8 on #609; /api/places takes no idempotency key). A lookup
    // that fails isn't "not there": nothing is created until one works.
    const attempted = pendingCreation.current;
    if (!placeId && attempted) {
      const lookup = await findCreatedPlace(attempted.name, attempted.latitude, attempted.longitude, openingPlaceIds.current);
      if (!alive.current) return;
      if (lookup === "failed") {
        setBusy(false);
        setError("Couldn't check whether the place was saved. Check your connection and try again.");
        return;
      }
      pendingCreation.current = null;
      setPendingCreationName(null);
      if (lookup) {
        placeId = lookup;
        setCreatedPlaceId(placeId);
      }
    }
    if (!placeId) {
      const radiusMeters = Math.round(Math.min(250, Math.max(75, evidence.map.stayRadiusMeters ?? 100)));
      pendingCreation.current = { name, latitude, longitude };
      setPendingCreationName(name);
      const response = await clientFetch("/api/places", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, latitude, longitude, radiusMeters }) }).catch(() => null);
      const created = response?.ok ? await response.json().catch(() => null) as { place?: { id?: string } } | null : null;
      if (!alive.current) return;
      placeId = created?.place?.id ?? null;
      // Only a definitive refusal (4xx) is a known "nothing saved"; a 5xx or gateway error, an unreadable body or a lost
      // reply may have committed, so its outcome stays unknown and the next try looks first (Codex r9 on #609).
      if (placeId || (response && response.status >= 400 && response.status < 500)) {
        pendingCreation.current = null;
        setPendingCreationName(null);
      }
      if (!placeId) {
        setBusy(false);
        setError("The place wasn't saved. Saving a place needs a connection.");
        return;
      }
      setCreatedPlaceId(placeId);
    }
    // The visit set to the new place, then the dialog's other edits (times, Logs as), as one Save.
    setBusy(false);
    await apply(`saved:${placeId}`);
  }

  /** "I wasn't here": the place leaves the day and the trips either side become one (step 12 part 4). */
  async function removePlace() {
    if (target.kind !== "place") return;
    setBusy(true);
    setError(null);
    const failure = await send({ kind: "delete", subject: "place", itemId: target.place.id })
      .catch(() => "Couldn't save that. Check your connection and try again.");
    if (!alive.current) return;
    if (failure) {
      setBusy(false);
      setError(failure);
      return;
    }
    await corrected();
    if (!alive.current) return;
    setBusy(false);
    onClose();
  }

  const questionCard = question && legOfTrip === null ? (
    <div className="location-correction-question" data-section="question" role="group" aria-label={question.text}>
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
  // A creation whose outcome isn't known counts as a change, so the footer recovers it instead of answering Yes
  // (Codex r3 on #636).
  const changed = typeof pendingNow === "string" || pendingNow.length > 0 || Boolean(newPlaceName.trim()) || pendingCreationName !== null;
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
          {/* The same keyed map as the leg's view, so a leg swap keeps one map instance (glitch fix 5). */}
          <EvidenceMap evidence={evidence} key="trip-map" knownPlace={false} />
          <div className="location-correction-section" data-section="corrections">
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
          <div aria-label="Fix this trip" className="location-correction-shape" role="group">
            {confirmingTrip ? (
              <div className="location-correction-confirm">
                <p>{confirmingTrip === "merge" ? "Make this one stay? The places either side join into one." : "Take this trip off your day?"}</p>
                <div className="location-correction-confirm-actions">
                  <Button compact disabled={busy} onClick={() => void fixTrip(confirmingTrip)} variant="danger">
                    {confirmingTrip === "merge" ? "Make it one stay" : "Take it off your day"}
                  </Button>
                  <Button compact disabled={busy} onClick={() => setConfirmingTrip(null)}>Keep it</Button>
                </div>
              </div>
            ) : (
              <>
                <Button compact disabled={busy} onClick={() => setConfirmingTrip("merge")}>I didn&apos;t leave</Button>
                <Button compact disabled={busy} onClick={() => setConfirmingTrip("delete")}>This wasn&apos;t a trip</Button>
              </>
            )}
          </div>
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
          {legOfTrip !== null ? <EvidenceMap evidence={evidence} key="trip-map" knownPlace={false} leg={leg} /> : null}
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
  const logActivities = activities.slice(0, 8);

  // The dialog is the question (owner, 30 Oct 2026): the map, a short list where a tap answers, and the footer.
  // The list: Apple's three nearest places, then up to two saved places within about 1 km; everything else
  // through the one search. "Logs as", the times and "Save this place" wait behind "More options".
  const centre = evidence && evidence !== "unavailable" ? evidence.map.centre : null;
  const text = query.trim();
  const needle = text.toLowerCase();
  const savedRows = needle
    ? places.filter((option) => option.name.toLowerCase().includes(needle)).slice(0, 3)
    : distances
      ? sortedPlaces.filter((option) => option.id !== currentPlaceId && (distances.get(option.id) ?? Infinity) <= 1_000).slice(0, 2)
      : [];
  const currentRow = place.placeId
    ? places.find((option) => option.id === place.placeId) ?? null : null;
  const placeGlyph = (option: CorrectionPlace) => option.role === "home" ? DAYFRAME_APP_ICONS.placeHome
    : option.role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places;
  const rows = [
    ...(currentRow && !needle ? [{ key: `saved:${currentRow.id}`, glyph: placeGlyph(currentRow), name: currentRow.name, note: "This place" }] : []),
    ...(place.learnedPlaceId && !place.placeId && !needle
      ? [{ key: original, glyph: DAYFRAME_APP_ICONS.places, name: place.name ?? "Learned place", note: "Learned place" }] : []),
    ...savedRows.filter((option) => option.id !== currentRow?.id || needle).map((option) => ({ key: `saved:${option.id}`, glyph: placeGlyph(option), name: option.name,
      note: distances?.has(option.id) ? `Saved place · ${formatMetres(distances.get(option.id)!)} away` : "Saved place" }))
  ];
  const canSaveNew = !place.placeId && Boolean(centre);
  const yesQuestion = question?.yesLabel ? question : null;
  const footerNext = (
    <>
      {question ? <Button disabled={busy} onClick={() => void answer(false)} variant="ghost">{question.noLabel}</Button> : null}
      {yesQuestion && !changed
        ? <Button disabled={busy} onClick={() => void answer(true)} variant="primary">{yesQuestion.yesLabel}</Button>
        // A name typed in Save this place is saved too, with the rest (Codex r1 on #636).
        // A creation whose reply was lost (from a tap, a search or the field) is looked up first (Codex r2 on #636).
        : <Button disabled={busy} onClick={() => void (canSaveNew && (newPlaceName.trim() || pendingCreationName !== null)
          ? saveThisPlace(newPlaceName.trim() ? undefined : pendingCreationName ?? undefined) : apply())} variant="primary">Save</Button>}
    </>
  );
  return (
    <ModalDialog busy={busy} className="location-correction-dialog is-next" description={open ? `Since ${formatTime(place.startedAt, clock)}`
      : `${formatTime(place.startedAt, clock)}–${formatTime(place.stoppedAt!, clock)}`}
      footer={footerNext} onClose={onClose} size="compact" title={target.label}>
      <div className="location-correction is-next">
        {question && question.text !== "Where were you?" ? <p className="location-correction-ask">{question.text}</p> : null}
        <EvidenceMap evidence={evidence} knownPlace={Boolean(place.placeId || place.learnedPlaceId)} />
        <div className="location-correction-section" data-section="where">
          <label className="ui-compound-control df-flist-search location-correction-search">
            <DayframeIcon glyph="search" size={16} />
            <input aria-label="Search places" disabled={busy} onChange={(event) => setQuery(event.target.value)}
              placeholder="Search places" type="text" value={query} />
          </label>
          {!place.placeId && mapProvider === "mapkit" && centre ? (
            <NearbyPlaces
              centre={{ latitude: centre.coordinates[1], longitude: centre.coordinates[0] }}
              disabled={busy}
              onPick={(name) => void saveThisPlace(name)}
              onUnavailable={() => setMapProvider("maplibre")}
              pickLabel="Saves it as a place and sets this visit to it"
              query={query}
              rows={3}
              searchRows={3}
            />
          ) : null}
          {rows.length || (text && canSaveNew) ? (
            <ul aria-label={text ? "Saved places found" : "Saved places nearby"} className="location-correction-options">
              {rows.map((row) => (
                <li key={row.key}>
                  <button aria-current={picked === row.key ? "true" : undefined} className="location-correction-option" disabled={busy}
                    onClick={() => void apply(row.key)} type="button">
                    <DayframeIcon glyph={row.glyph} size={18} />
                    <span><b>{row.name}</b>{row.note ? <small>{row.note}</small> : null}</span>
                    {picked === row.key ? <Check aria-hidden="true" className="location-correction-check" size={16} strokeWidth={2.5} /> : null}
                  </button>
                </li>
              ))}
              {text && canSaveNew ? (
                <li>
                  <button className="location-correction-option is-save" disabled={busy} onClick={() => void saveThisPlace(text)} type="button">
                    <DayframeIcon glyph="plus" size={18} />
                    <span><b>Save “{text}” as a place</b></span>
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>
        <button aria-controls={`location-correction-more-${place.id}`} aria-expanded={moreOptions} className="location-correction-disclosure"
          disabled={busy} onClick={() => setMoreOptions((value) => !value)} type="button">
          <span>More options</span>
          {moreOptions ? <ChevronUp aria-hidden="true" size={16} /> : <ChevronDown aria-hidden="true" size={16} />}
        </button>
        {moreOptions ? (
          <div className="location-correction-more-options" id={`location-correction-more-${place.id}`}>
            {!place.blockIds.length ? (
              <div className="location-correction-section" data-section="logs-as">
                <span className="location-correction-label" id="location-correction-logs-as">Logs as</span>
                <div aria-labelledby="location-correction-logs-as" className="df-rchips location-correction-logs-as" role="radiogroup">
                  {logActivities.map((activity) => (
                    <button aria-checked={logAs === activity.id} className={`df-rchip${logAs === activity.id ? " is-checked" : ""}`}
                      ref={(element) => { if (element) logAsChips.current.set(activity.id, element); else logAsChips.current.delete(activity.id); }}
                      disabled={busy} key={activity.id} onClick={() => setLogAs(logAs === activity.id ? null : activity.id)} role="radio"
                      style={blockStyle(activity.color ?? null, activity.name)} type="button">
                      <ActivityChipFace activity={{ color: activity.color ?? activity.id, icon: activity.icon ?? null, name: activity.name }} checked={logAs === activity.id} />
                    </button>
                  ))}
                </div>
                {logAs ? <p className="location-correction-hint">Fills only the time your own blocks don’t cover.</p> : null}
              </div>
            ) : null}
            {open ? null : (
              <div aria-label="Times" className="location-correction-times" data-section="times" role="group">
                <label className="location-correction-time"><span>Start</span>
                  <TimeField clock={clock} disabled={busy} label="Start time" onChange={setStart} value={start} />
                </label>
                <label className="location-correction-time"><span>End</span>
                  <TimeField clock={clock} disabled={busy} label="End time" onChange={setEnd} placeholder="09:15" value={end} />
                </label>
              </div>
            )}
            {canSaveNew ? (
              <div aria-label="Save this place" className="location-correction-save" role="group">
                <input aria-label="Name for this place" className="ui-control" disabled={busy} onChange={(event) => setNewPlaceName(event.target.value)}
                  ref={newPlaceNameRef} placeholder="Save this place as…" type="text" value={newPlaceName} />
                <Button disabled={busy || !newPlaceName.trim()} onClick={() => void saveThisPlace()}>Save place</Button>
              </div>
            ) : null}
            {original !== "unknown" ? (
              <button className="location-correction-more" disabled={busy} onClick={() => void apply("unknown")} type="button">Leave as unknown</button>
            ) : null}
            {!open && target.joinsTrips ? (
              <div aria-label="Fix this place" className="location-correction-shape" role="group">
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
            ) : null}
          </div>
        ) : null}
        {error ? <p className="location-correction-error" role="alert">{error}</p> : null}
      </div>
    </ModalDialog>
  );

}

/** Metres between two points a few metres apart (equirectangular is exact enough at this scale). */
function metresBetween(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = Math.PI / 180;
  const x = (longitudeB - longitudeA) * radians * Math.cos(((latitudeA + latitudeB) / 2) * radians);
  const y = (latitudeB - latitudeA) * radians;
  return Math.sqrt(x * x + y * y) * 6_371_000;
}

/**
 * A place "Save this place" already created though its reply was lost: same name, within 10 m of the visit's centre,
 * and not among the places the dialog opened with. Null when the list says there is none; "failed" when the list
 * can't be read, which says nothing either way.
 */
async function findCreatedPlace(name: string, latitude: number, longitude: number, existing: ReadonlySet<string>): Promise<string | null | "failed"> {
  const response = await clientFetch("/api/places", { cache: "no-store" }).catch(() => null);
  const body = response?.ok ? await response.json().catch(() => null) as { places?: Array<{ id?: unknown; name?: unknown; latitude?: unknown; longitude?: unknown }> } | null : null;
  if (!body || !Array.isArray(body.places)) return "failed";
  const wanted = name.trim().toLowerCase();
  const found = (body?.places ?? []).find((place) => typeof place.id === "string" && !existing.has(place.id) &&
    typeof place.name === "string" && place.name.trim().toLowerCase() === wanted &&
    typeof place.latitude === "number" && typeof place.longitude === "number" &&
    metresBetween(latitude, longitude, place.latitude, place.longitude) <= 10);
  return typeof found?.id === "string" ? found.id : null;
}

/** "120 m", "1.4 km". */
function formatMetres(metres: number) {
  return metres < 1_000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1_000).toFixed(1)} km`;
}
