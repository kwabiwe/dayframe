import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Reanimated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_BLOCKS,
  DAYFRAME_LEG_MODE_ICONS,
  LEG_MODE_LABEL,
  evidenceSheetCaption,
  formatClockTime,
  formatDuration,
  legDetail,
  legModeLabel,
  type ClockFormat,
  type TimelineItemEvidenceDto,
  type TimelinePlace,
  type TimelineTrip,
  type TripLegMode
} from "@dayframe/shared";
import type { DayframeTimeWheelChange } from "../../../modules/dayframe-time-wheel";
import { BottomSheetShell, type BottomSheetScroller } from "../sheets/BottomSheetShell";
import { TimeWheelPanel } from "../TimeWheelPanel";
import { DayframeIcon } from "../icons/DayframeIcon";
import { LocationEvidenceMap } from "../location/LocationEvidenceMap";
import { playHaptic } from "../../lib/haptics";
import { MOBILE_MOTION, localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import { formatPlaceDistance } from "../../lib/placeCategories";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { SheetNearbySearch, type SheetSavedRow } from "./SheetNearbySearch";
import { ActivityChip, activityChipStyles } from "../ActivityChips";
import type { ReviewAnswerVenue } from "../../lib/reviewAnswer";
import { nearbyProposalKey } from "../../lib/nearbyProposal";
import { keepableVenue } from "../../lib/venueGuessEligibility";
import { COMPACT_PILL_HIT_SLOP, compactPillStyles } from "../compactPill";
import { timeWheelAccessibilityStep } from "../../lib/timeWheel";
import {
  correctable,
  didntLeave,
  legCorrection,
  notATrip,
  notHere,
  placeCorrections,
  timesProblem,
  tripCorrections,
  type CorrectionPlaceOption,
  type CorrectionTimes,
  type PlaceChoice,
  type QueuedCorrection
} from "../../lib/locationCorrectionDraft";

/**
 * The iPhone place and trip sheets (location v4 step 12; the web's approved design, #636 and #639, brought over; brand
 * guide "Place and trip sheet"): the sheet is the question. One `BottomSheetShell` owns presentation (its spring in, its
 * handle, ✕ or backdrop out with no change, the footer pinned at the bottom); a trip's leg pushes and pops inside it with
 * a short fade-and-slide (a fade with Reduce Motion).
 *
 * Top to bottom, the ones that apply (`SHEET_SECTION_ORDER`): the title, times and ✕, and the question's one fixed line,
 * which becomes "Visited {name}?" when Apple has a guess; a 160-point map, mounted once the sheet has settled; a place's
 * one search over up to five rows (Apple's three nearest, up to two saved places within about 1 km, the guess ticked, a
 * tap answers) or a trip's legs; "More options" (Logs as, the times, the corrections), which scrolls itself into view.
 * The footer is a quiet "Don't log" and the primary Save, or Yes for a guess or a question with one. Save queues only what changed (`locationCorrectionDraft`): the List shows it at once
 * and the correction queue sends it. Only what the timeline API can set is offered.
 */

/** The sheet's sections, top to bottom, as their testIDs; a sheet shows the ones that apply, in this order. */
export const SHEET_SECTION_ORDER = [
  "location-correction-map",
  "location-correction-where",
  "location-correction-legs",
  "location-correction-more"
] as const;
/** What "More options" holds, in this order. */
export const SHEET_MORE_OPTIONS_ORDER = [
  "location-correction-logs-as",
  "location-correction-times",
  "location-correction-corrections"
] as const;

/** Saved places listed without a search: at most this many, within this far of the visit (the web's rule). */
export const SHEET_SAVED_ROWS = 2;
export const SHEET_SAVED_RADIUS_METERS = 1_000;
export const SHEET_MAP_HEIGHT = 160;
/** The map waits for the sheet's spring: MapKit starting mid-spring is what stutters. */
export const SHEET_MAP_DELAY_MS = 320;
/** More options closes once the scroll back has run. */
const SHEET_SCROLL_BACK_MS = 240;

/** `notHere` / `didntLeave`: whether the List lets "I wasn't here" or "I didn't leave" join its neighbours (step 12 part 4). */
/** Kept before the corrections with `ids` are queued; `start` once they are, `cancel` if they can't be. */
/**
 * `generation`: the account lifetime of the tap that began it (`currentMobileAccountEpoch`, captured before its first
 * await and carried through creation, queueing and registration; Codex r17 on #610).
 */
export type LocationCorrectionBeforeEnqueue = (ids: readonly string[], generation: number) => Promise<{ start: () => void; cancel: () => Promise<void> }>;

export type LocationCorrectionTarget =
  | { kind: "place"; place: TimelinePlace; label: string; notHere?: boolean }
  | { kind: "trip"; trip: TimelineTrip & { route?: string }; legIndex: number | null; didntLeave?: boolean };

type Join = "remove" | "not_here" | "didnt_leave";

const LEG_MODES: TripLegMode[] = ["walking", "running", "cycling", "automotive", "bus", "train", "underground", "tram"];
const TIME_FIELD_ACCESSIBILITY_ACTIONS = [
  { name: "increment" },
  { name: "decrement" },
  { name: "activate" },
  { name: "plusMinute", label: "Plus 1 minute" },
  { name: "minusMinute", label: "Minus 1 minute" }
] as const;

export function LocationCorrectionSheet({
  clockFormat,
  evidence,
  onDismissed,
  onQueue,
  onSavePlace,
  logAs,
  places,
  presentationId,
  question,
  reduceMotion,
  rootHosted,
  stale = false,
  target,
  theme
}: {
  clockFormat: ClockFormat;
  /**
   * Owner item A (28 Oct 2026): the item's open "?", asked at the top of its sheet now that a row or a
   * Grid item opens the sheet directly. An answer closes the sheet (with any change made in it kept too).
   */
  question?: {
    /** A missing label is an answer that isn't available here: its pill isn't shown (Codex r16 on #610). */
    text: string; detail?: string | null; yesLabel: string | null; noLabel: string | null;
    /**
     * The near guess (PRD D23): "Visited {name}?", its row ticked and the primary reading Yes. The caller's own guess,
     * else the one the sheet's nearby list makes for an unknown place. Tapping another row answers with that one.
     */
    guess?: ReviewAnswerVenue | null;
    /**
     * Whether the sheet's own Nearby list may guess for this "?" (`venueGuessEligible`, Calendar's one rule; Codex r5 on
     * #620): only an unnamed visit with its whole window, an outing's stay included, and never a question already
     * titled with a name ("Visited Bread run?"), whose name is kept.
     */
    guessable?: boolean;
    /** An outing's stay: a guess needs its Apple Place ID, or `confirm_outing` couldn't keep it (`keepableVenue`). */
    outing?: boolean;
    /**
     * Answers now (held for Undo): the sheet has no changes of its own. Whether it was taken; refused, the sheet stays.
     * `venue`: Yes to a guess, recorded there once (`record_poi_once`); `logAsCategoryId`: the activity picked under
     * Logs as with it, recorded as that activity (Codex r1 on #620).
     */
    onAnswer: (yes: boolean, venue?: ReviewAnswerVenue | null, logAsCategoryId?: string | null) => boolean | void;
    /**
     * Answers after the sheet's own changes (Codex r2 on #610): kept on the phone first, waiting for the corrections
     * with these ids to be acknowledged by the server; `start` begins its Undo once they are queued, `cancel`
     * removes it if they can't be.
     */
    answerAfter?: (yes: boolean, ids: readonly string[], generation: number, venue?: ReviewAnswerVenue | null,
      logAsCategoryId?: string | null) => ReturnType<LocationCorrectionBeforeEnqueue>;
  } | null;
  /** The item's map: null while it loads, "unavailable" when it couldn't be read. */
  evidence: TimelineItemEvidenceDto | "unavailable" | null;
  onDismissed: (presentationId: number) => void;
  /**
   * Keeps these corrections on the phone and sends them (the List shows them at once). Resolves once they are
   * kept: the sheet closes only then, and keeps its draft when they couldn't be (Codex r1 on #602).
   */
  onQueue: (corrections: QueuedCorrection[], options: { closing: boolean; beforeEnqueue?: LocationCorrectionBeforeEnqueue }) => Promise<void>;
  /**
   * "Save this place" (step 12 part 4, card D item 14): saves the visit's place under this name and sets the
   * visit to it; absent when it can't be offered (a named place, a block, or no map to place it by).
   */
  /**
   * `beforeEnqueue`: a Logs as that waits for the server to accept the visit's corrections (Codex r4 on #610).
   * `applePlaceId`: the Apple place picked from Nearby under this name, when the name is still that pick's.
   */
  onSavePlace?: (name: string, rest: QueuedCorrection[], beforeEnqueue?: LocationCorrectionBeforeEnqueue, applePlaceId?: string | null) => Promise<void>;
  /**
   * "Logs as" (step 12 part 4c): the activities to pick from, and what logging the place as one does (held for
   * Undo, then sent); absent when the place can't be logged here (a question, a block, or not ended).
   */
  logAs?: {
    activities: ReadonlyArray<{ id: string; name: string; color?: string | null; icon?: string | null }>;
    /** Every activity, for "All activities", when there are more than `activities`. */
    allActivities?: ReadonlyArray<{ id: string; name: string; color?: string | null; icon?: string | null }>;
    /** Logs the place now (held for Undo): the sheet has no corrections of its own to go first. */
    onLog: (categoryId: string) => void;
    /**
     * Logs it after the sheet's corrections (Codex r4 on #610): kept on the phone before they are queued, and sent as
     * `log_place` only once the server has acknowledged every one; a refused one means nothing is logged.
     */
    onLogAfter?: (categoryId: string, ids: readonly string[], generation: number) => ReturnType<LocationCorrectionBeforeEnqueue>;
  };
  /** The saved places, for "Where were you?". */
  places: readonly CorrectionPlaceOption[];
  presentationId: number;
  reduceMotion: boolean;
  rootHosted: boolean;
  /** The item left the List while its sheet was open: shown as it was, with nothing to change (Codex r1 on #602). */
  stale?: boolean;
  target: LocationCorrectionTarget;
  theme: MobileTheme;
}) {
  const item = target.kind === "place" ? target.place : target.trip;
  const [choice, setChoice] = useState<PlaceChoice>({ kind: "keep" });
  // Only the ends the person moved: an untouched end follows the item when the List refreshes, so a refresh
  // never becomes a correction (Codex r1 on #602).
  const [edited, setEdited] = useState<{ startMs?: number; stopMs?: number | null }>({});
  const times: CorrectionTimes = {
    startMs: edited.startMs ?? Date.parse(item.startedAt),
    stopMs: edited.stopMs !== undefined ? edited.stopMs : item.stoppedAt ? Date.parse(item.stoppedAt) : null
  };
  // Nothing in the draft changes while a change is being kept, or once it is: what was kept is what closes
  // (Codex r3 on #602).
  const frozen = () => saving || kept.current;
  const setTimes = (next: CorrectionTimes) => frozen() ? undefined : setEdited((current) => ({
    ...current,
    ...(next.startMs !== times.startMs ? { startMs: next.startMs } : {}),
    ...(next.stopMs !== times.stopMs ? { stopMs: next.stopMs } : {})
  }));
  // The leg shown, pushed inside the trip sheet, by its exact times: a refresh that merges legs never moves the
  // choice to another leg (Codex r1 on #602); its picked mode until its Done.
  const openedLeg = target.kind === "trip" && target.legIndex != null ? target.trip.legs[target.legIndex] ?? null : null;
  const [legKey, setLegKey] = useState<{ startedAt: string; stoppedAt: string } | null>(
    openedLeg ? { startedAt: openedLeg.startedAt, stoppedAt: openedLeg.stoppedAt } : null);
  const [legMode, setLegMode] = useState<TripLegMode | null>(null);
  // Which way the last push went, for the leg view's slide.
  const [direction, setDirection] = useState<1 | -1>(1);
  // Opened at a leg from the List: its Done closes the sheet, unless the person went back to the trip.
  const [leftLeg, setLeftLeg] = useState(false);
  const commitRef = useRef<(() => void) | null>(null);
  // What Done does: a removal or a join only when its confirm asked for it, once (Codex r1 on #602).
  const intent = useRef<Join | null>(null);
  // Kept on the phone: the next commit closes the sheet.
  const kept = useRef(false);
  // Logs as waiting for this Save's corrections to be kept.
  const pendingLog = useRef<(() => void) | null>(null);
  // The place a tap answered with, for the commit it starts.
  const pickedNow = useRef<PlaceChoice | null>(null);
  // ✕: the shell's own discard, as the handle and backdrop.
  const discardRef = useRef<(() => void) | null>(null);
  const scroller = useRef<BottomSheetScroller | null>(null);
  // The footer's primary is the question's Yes, or Yes to the guess, as of the last render.
  let footerYes = false;
  let footerGuess: ReviewAnswerVenue | null = null;

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Kept: the sheet closes on the next render, once Done is enabled again (Codex r2 on #602).
  const [closeKept, setCloseKept] = useState(false);
  useEffect(() => {
    if (closeKept) commitRef.current?.();
  }, [closeKept]);
  const time = (ms: number) => formatClockTime(new Date(ms), clockFormat);
  const span = `${time(Date.parse(item.startedAt))}–${item.stoppedAt ? time(Date.parse(item.stoppedAt)) : "now"}`;
  const problem = correctable(item) ? timesProblem(item, times) : null;
  const trip = target.kind === "trip" ? target.trip : null;
  const legIndex = trip && legKey ? trip.legs.findIndex((each) => each.startedAt === legKey.startedAt && each.stoppedAt === legKey.stoppedAt) : -1;
  const leg = trip && legIndex >= 0 ? trip.legs[legIndex] : null;
  // The leg left the trip (merged, or replay moved it): back to the trip's legs, with nothing picked.
  if (legKey && !leg && !stale) {
    setLegKey(null);
    setLegMode(null);
  }

  function openLeg(index: number) {
    if (!trip || frozen()) return;
    setDirection(1);
    setLegMode(null);
    setLegKey({ startedAt: trip.legs[index].startedAt, stoppedAt: trip.legs[index].stoppedAt });
  }

  function backToTrip() {
    if (kept.current) return;
    setLeftLeg(true);
    setDirection(-1);
    setLegMode(null);
    setLegKey(null);
  }

  /** Keeps the corrections on the phone, then closes (or goes back to the trip); the draft stays if they couldn't be kept. */
  function keep(corrections: QueuedCorrection[], then: "close" | "trip", beforeEnqueue?: LocationCorrectionBeforeEnqueue) {
    setSaving(true);
    setSaveError(null);
    onQueue(corrections, { closing: then === "close", ...(beforeEnqueue ? { beforeEnqueue } : {}) }).then(() => {
      setSaving(false);
      if (then === "trip") {
        backToTrip();
        return;
      }
      kept.current = true;
      pendingLog.current?.();
      pendingLog.current = null;
      setCloseKept(true);
    }, () => {
      pendingLog.current = null;
      intent.current = null;
      setSaving(false);
      setSaveError("That change couldn't be kept on this iPhone. Try again.");
    });
  }

  function apply() {
    if (kept.current) return true;
    if (stale || saving) return false;
    // A tap on a place answers with that place, whatever the footer says.
    const picked = pickedNow.current ?? choice;
    if ((footerYes || footerGuess) && !pickedNow.current) {
      answerFromSheet(true, footerGuess);
      return false;
    }
    if (intent.current) {
      // A join is offered only while the List allows it; one that no longer is (a neighbour in a block now) is
      // not sent (Codex r1 on #606).
      const change = intent.current === "remove" && trip ? notATrip(trip)
        : intent.current === "didnt_leave" && trip && target.kind === "trip" && target.didntLeave ? didntLeave(trip)
          : intent.current === "not_here" && target.kind === "place" && target.notHere ? notHere(target.place) : null;
      if (!change) {
        intent.current = null;
        setConfirming(null);
        return false;
      }
      keep([change], "close");
      return false;
    }
    if (trip && leg) {
      // A leg's Done sends its mode and goes back to the trip; the trip's own Done closes the sheet.
      const change = legMode ? legCorrection(trip, legIndex, legMode) : null;
      const closes = target.kind === "trip" && target.legIndex != null && !leftLeg;
      if (change) {
        playHaptic("timeSet");
        keep([change], closes ? "close" : "trip");
        return false;
      }
      if (closes) return true;
      backToTrip();
      return false;
    }
    if (problem) return false;
    // A name typed under More options is saved with the rest, as the web's Save (Codex r1 on #636).
    if (!pickedNow.current && onSavePlace && (attempted || placeName.trim())) {
      if (attempted) savePlace(attempted.name, attempted.applePlaceId);
      else savePlace();
      return false;
    }
    const corrections = target.kind === "place"
      ? placeCorrections(target.place, { choice: picked, times }, places)
      : tripCorrections(target.trip, { times });
    // Logs as is held for Undo and sent after the place's own changes, which it then logs.
    const log = target.kind === "place" && logAs && logCategoryId ? () => logAs.onLog(logCategoryId) : null;
    if (!corrections.length) {
      log?.();
      return true;
    }
    const logAfter = target.kind === "place" && logAs?.onLogAfter && logCategoryId ? logAs.onLogAfter : null;
    if (logAfter && logCategoryId) {
      // Logs as waits for these corrections to be acknowledged, never merely kept on the phone (Codex r4 on #610).
      const categoryId = logCategoryId;
      keep(corrections, "close", (ids, generation) => logAfter(categoryId, ids, generation));
      return false;
    }
    pendingLog.current = log;
    keep(corrections, "close");
    return false;
  }

  /** A tap on a place answers (the web's rule): that place, with any other edits, and the sheet closes. */
  function commitChoice(next: PlaceChoice) {
    if (frozen() || stale) return;
    if (problem) {
      setSaveError("Those times don't work yet. Fix them, then save.");
      return;
    }
    setAttempted(null);
    setChoice(next);
    pickedNow.current = next;
    commitRef.current?.();
    pickedNow.current = null;
  }

  // "This wasn't a trip", "I wasn't here" and "I didn't leave" each ask once, in place (UIA-005: no system alert).
  const [confirming, setConfirming] = useState<Join | null>(null);
  // The name typed under More options.
  const [placeName, setPlaceName] = useState("");
  // A place tapped (Apple's, or "Save “X” as a place") until it saves: its name and Place ID stay in the draft, so
  // the footer's Save tries it again after a failure (Codex r2 on #641).
  const [attempted, setAttempted] = useState<{ name: string; applePlaceId: string | null } | null>(null);
  // The near guess from the sheet's own nearby list (PRD D23).
  // Kept with the visit it was ranked for (`nearbyProposalKey`; Codex r1 on #620).
  const [nearbyGuess, setNearbyGuess] = useState<{ venue: ReviewAnswerVenue | null; proposal: string } | null>(null);
  // The activity picked under Logs as; none is "Don't log", as the place is now.
  const [logCategoryId, setLogCategoryId] = useState<string | null>(null);
  const [allActivities, setAllActivities] = useState(false);
  const [moreOptions, setMoreOptions] = useState(false);
  const moreRow = useRef<View | null>(null);
  // Opened and not yet scrolled to: its first layout does it.
  const revealMore = useRef(false);
  const closingMore = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closingMore.current) clearTimeout(closingMore.current); }, []);
  // The map waits for the sheet's spring; with Reduce Motion there is none.
  const [mapReady, setMapReady] = useState(reduceMotion);
  useEffect(() => {
    if (mapReady) return;
    const timer = setTimeout(() => setMapReady(true), SHEET_MAP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [mapReady]);
  /** Opens with the row scrolled to the sheet's top; closes by scrolling back first, so nothing snaps. */
  function toggleMore() {
    const closing = moreOptions && !closingMore.current;
    if (closingMore.current) clearTimeout(closingMore.current);
    closingMore.current = null;
    if (!closing) {
      revealMore.current = !moreOptions;
      setMoreOptions(true);
      if (moreOptions) scroller.current?.reveal(moreRow.current, "top");
      return;
    }
    scroller.current?.top();
    if (reduceMotion) {
      setMoreOptions(false);
      return;
    }
    closingMore.current = setTimeout(() => {
      closingMore.current = null;
      setMoreOptions(false);
    }, SHEET_SCROLL_BACK_MS);
  }
  /**
   * "Save this place": `chosenName` is a tap (an Apple place, or "Save “X” as a place"), otherwise the name typed under
   * More options. The place saved and the visit set to it, then the sheet's other changes and its Logs as, in one step.
   */
  function savePlace(chosenName?: string, applePlaceId: string | null = null) {
    const name = (chosenName ?? placeName).trim();
    if (!onSavePlace || !name || frozen() || stale || target.kind !== "place") return;
    if (problem) {
      setSaveError("Those times don't work yet. Fix them, then save.");
      return;
    }
    // The place saved, then the sheet's other changes (its times) and its Logs as, in one Done (Codex r1 on #606).
    const rest = placeCorrections(target.place, { choice: { kind: "keep" }, times }, places);
    // With a Logs as picked, the log waits on the phone until the server has the place's corrections (the place
    // itself is created on the server first), never merely their keeping here; a refused one logs nothing and the
    // "?" stays (Codex r4 on #610). Without `onLogAfter` it logs once they are kept, as before.
    const categoryId = logCategoryId;
    const logAfter = logAs?.onLogAfter && categoryId ? logAs.onLogAfter : null;
    const log = !logAfter && logAs && categoryId ? () => logAs.onLog(categoryId) : null;
    if (chosenName !== undefined) setAttempted({ name, applePlaceId });
    setSaving(true);
    setSaveError(null);
    onSavePlace(name, rest, logAfter && categoryId ? (ids, generation) => logAfter(categoryId, ids, generation) : undefined,
      applePlaceId).then(() => {
      setSaving(false);
      kept.current = true;
      log?.();
      setCloseKept(true);
    }, () => {
      setSaving(false);
      setSaveError(chosenName !== undefined
        ? `“${name}” wasn't saved. Saving a place needs a connection; Save tries again.`
        : "That place couldn't be saved. Saving a place needs a connection; try again.");
    });
  }
  /**
   * The "?" at the top answered, in one tap (owner, 28 Oct 2026; Codex r2 on #610). With no changes of its own the
   * answer is held for Undo at once. With changes, they are kept as Save keeps them (the correction outbox, shown in
   * the List at once) and the answer waits on the phone until the server has acknowledged them, so it can never
   * reach the server first; a refused change drops it, and the "?" stays. A Logs as pick is never lost (Codex r3 on
   * #610): Yes with an activity picked is Logs as — Save's own flow, the sheet's corrections and then `log_place`
   * with that activity, which closes the "?" on the server (#609) — and no separate answer is sent. Don't log with an
   * activity picked answers it and drops the pick.
   */
  function answerFromSheet(yes: boolean, venue: ReviewAnswerVenue | null = null) {
    if (!question || frozen() || stale) return;
    // An answer leaves a tapped place that didn't save behind.
    setAttempted(null);
    // Yes to a guessed venue keeps the venue on every path (Codex r1 on #620): with Logs as picked, the venue is
    // recorded once as that activity (one `record_poi_once` answer, after the sheet's corrections), never `log_place`.
    if (yes && logCategoryId && logAs && !venue) {
      commitRef.current?.();
      return;
    }
    const logAsCategoryId = yes && venue && logCategoryId ? logCategoryId : null;
    if (!yes && logCategoryId) setLogCategoryId(null);
    if (confirming) {
      setSaveError("Finish the change above first, then answer.");
      return;
    }
    if (problem) {
      setSaveError("Those times don't work yet. Fix them, then answer.");
      return;
    }
    // Yes to a guess replaces a place picked before it (one that failed to keep); times and Logs as stay.
    const answerChoice: PlaceChoice = venue ? { kind: "keep" } : choice;
    if (venue) setChoice(answerChoice);
    const corrections = target.kind === "place"
      ? placeCorrections(target.place, { choice: answerChoice, times }, places)
      : tripCorrections(target.trip, { times });
    if (!corrections.length) {
      // Refused (it can't be answered here now): the sheet stays open with its question; nothing is taken as done.
      if ((venue ? question.onAnswer(yes, venue, logAsCategoryId) : question.onAnswer(yes)) === false) {
        setSaveError("This can't be answered here right now.");
        return;
      }
      kept.current = true;
      setCloseKept(true);
      return;
    }
    const answerAfter = question.answerAfter;
    if (!answerAfter) {
      setSaveError("Save your changes first; the question updates after.");
      return;
    }
    keep(corrections, "close", (ids, generation) => venue
      ? answerAfter(yes, ids, generation, venue, logAsCategoryId) : answerAfter(yes, ids, generation));
  }
  function confirmJoin(join: Join) {
    if (frozen()) return;
    intent.current = join;
    commitRef.current?.();
  }
  function keepAsIs() {
    if (frozen()) return;
    intent.current = null;
    setConfirming(null);
  }

  const title = target.kind === "place"
    ? target.label
    : leg
      ? `${LEG_MODE_LABEL[legMode ?? leg.mode]} · ${formatDuration(Math.round((Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)) / 1000))}`
      : target.trip.legs.length === 1 ? LEG_MODE_LABEL[target.trip.legs[0].mode] : "Trip";
  const subtitle = leg && trip
    ? `Leg ${legIndex! + 1} of ${trip.legs.length} · ${time(Date.parse(leg.startedAt))}–${time(Date.parse(leg.stoppedAt))}`
    : trip?.route ? `${trip.route} · ${span}` : span;

  // Apple's nearby places for an unknown place that can be saved, from the visit's centre.
  const nearbyCentre = target.kind === "place" && onSavePlace && !stale && !target.place.placeId
    && evidence && evidence !== "unavailable" && evidence.map.centre
    ? { latitude: evidence.map.centre.coordinates[1], longitude: evidence.map.centre.coordinates[0] } : null;
  // The sheet's own guess only for the visit as it is now: the same centre and times, and evidence that describes
  // this place's times (as the Calendar's guess requires; Codex r1 on #620).
  const nearbyGuessNow = nearbyGuess && evidence && evidence !== "unavailable" && target.kind === "place"
    && nearbyGuess.proposal === nearbyProposalKey(nearbyCentre, evidence)
    && Date.parse(evidence.segment.startedAt) === Date.parse(target.place.startedAt)
    && Date.parse(evidence.segment.stoppedAt ?? "") === Date.parse(target.place.stoppedAt ?? "") ? nearbyGuess.venue : null;
  // The near guess the "?" asks about (PRD D23): only for a place whose "?" can be answered here.
  const guess = question && target.kind === "place" && question.noLabel != null
    ? question.guess ?? (question.guessable ? keepableVenue(nearbyGuessNow, Boolean(question.outing)) : null) : null;
  // The question's one line, in the title area: a guess only changes its words, so nothing moves when one arrives.
  const asks = question && !leg ? guess ? `Visited ${guess.name}?` : question.text : null;
  const placeCanSave = target.kind === "place" && !target.place.placeId && Boolean(onSavePlace) && !stale;
  const placeIsNamed = target.kind === "place" && Boolean(target.place.placeId || target.place.learnedPlaceId);
  const currentPlaceId = target.kind === "place" ? target.place.placeId : null;
  // How far each saved place is from the visit, as far as the map knows.
  const distances = evidence && evidence !== "unavailable" && evidence.map.centre
    ? new Map(evidence.map.nearbySavedPlaces.map((saved) => [saved.id, saved.distanceMeters] as const)) : null;
  const glyphOf = (role: string | null) => role === "home" ? DAYFRAME_APP_ICONS.placeHome : role === "work" ? DAYFRAME_APP_ICONS.placeWork : DAYFRAME_APP_ICONS.places;
  const isPicked = (key: string) => (choice.kind === "saved" ? choice.id : choice.kind === "unknown" ? null
    : currentPlaceId ?? (target.kind === "place" && target.place.learnedPlaceId ? "learned" : null)) === key;
  /** The saved places shown: the place itself first, then at most two within about 1 km; a search finds any by name. */
  const savedRows = (text: string): SheetSavedRow[] => {
    if (target.kind !== "place") return [];
    const needle = text.trim().toLowerCase();
    const row = (option: CorrectionPlaceOption, detail: string): SheetSavedRow => ({
      key: option.id, title: option.name, detail, glyph: glyphOf(option.role), checked: isPicked(option.id),
      onPress: () => commitChoice(option.id === currentPlaceId ? { kind: "keep" } : { kind: "saved", id: option.id })
    });
    const away = (option: CorrectionPlaceOption) => distances?.has(option.id)
      ? `Saved place · ${formatPlaceDistance(distances.get(option.id)!)} away` : "Saved place";
    if (needle) return places.filter((option) => option.name.toLowerCase().includes(needle)).slice(0, 3).map((option) => row(option, away(option)));
    const near = distances ? [...places]
      .filter((option) => option.id !== currentPlaceId && (distances.get(option.id) ?? Infinity) <= SHEET_SAVED_RADIUS_METERS)
      .sort((a, b) => distances.get(a.id)! - distances.get(b.id)!).slice(0, SHEET_SAVED_ROWS) : [];
    const current = places.find((option) => option.id === currentPlaceId);
    return [
      ...(current ? [row(current, "This place")] : []),
      ...(target.place.learnedPlaceId && !currentPlaceId && target.place.name ? [{
        key: "learned", title: target.place.name, detail: "Learned place", glyph: DAYFRAME_APP_ICONS.places, checked: isPicked("learned"),
        onPress: () => commitChoice({ kind: "keep" })
      }] : []),
      ...near.map((option) => row(option, away(option)))
    ];
  };
  const placeSection = target.kind === "place" && !stale && (correctable(target.place) || nearbyCentre);
  const hasMore = !leg && (target.kind === "place"
    ? !stale && (Boolean(logAs) || (correctable(item) && Boolean(item.stoppedAt)) || placeCanSave || Boolean(target.notHere))
    : correctable(item));
  const sheetChanged = Boolean(confirming) || Boolean(logCategoryId) || Boolean(legMode) || Boolean(placeName.trim()) || Boolean(attempted) || (!problem && (target.kind === "place"
    ? placeCorrections(target.place, { choice, times }, places).length > 0
    : tripCorrections(target.trip, { times }).length > 0));
  // The footer: a question with a Yes shows its Yes until something changes (the web's rule). A guess keeps its Yes
  // through edits to the times or Logs as, which go with the answer; a name or a place of the person's own is a Save.
  footerGuess = guess && !leg && !confirming && !placeName.trim() && !attempted && choice.kind === "keep" ? guess : null;
  footerYes = Boolean(question?.yesLabel && !guess && !leg && !sheetChanged);
  const notNow = question?.noLabel && !leg ? question.noLabel : null;
  return (
    <BottomSheetShell
      action={footerGuess ? "Yes" : footerYes ? question!.yesLabel! : "Save"}
      calendarLayout={false}
      commitRef={commitRef}
      discardRef={discardRef}
      // A removal or join needs no valid times; nothing changes while a change is being kept, or once the item
      // left. A kept change always closes.
      disabled={!closeKept && (stale || saving || (!leg && !confirming && Boolean(problem)))}
      onApply={apply}
      onDismissed={onDismissed}
      presentationId={presentationId}
      reduceMotion={reduceMotion}
      rootHosted={rootHosted}
      scrollerRef={scroller}
      secondaryAction={notNow ? { disabled: stale || saving, label: notNow, onPress: () => answerFromSheet(false), testID: "location-correction-question-no" } : undefined}
      testID="location-correction-sheet"
      theme={theme}
      title={title}
    >
      {/* The title, its times and ✕ (closes with no change, as the handle). */}
      <View style={styles.head}>
        {leg ? (
          <Pressable accessibilityLabel="Back to the trip" accessibilityRole="button" hitSlop={6} onPress={backToTrip}
            style={[styles.round, { backgroundColor: theme.surfaceMuted }]} testID="location-correction-back">
            <DayframeIcon color={theme.textPrimary} glyph="arrow-left" size={18} />
          </Pressable>
        ) : null}
        <View style={styles.headText}>
          <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
          <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{subtitle}</Text>
          {asks ? <Text {...mobileTextProps("body")} numberOfLines={target.kind === "place" ? 1 : undefined} style={[styles.ask, { color: theme.textPrimary }]} testID="location-correction-ask">{asks}</Text> : null}
        </View>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" hitSlop={6} onPress={() => discardRef.current?.()}
          style={[styles.round, { backgroundColor: theme.surfaceMuted }]} testID="location-correction-close">
          <DayframeIcon color={theme.textPrimary} glyph="x" size={18} />
        </Pressable>
      </View>
      {/* The map: the visit's own area, or the trip's route; it stays put as a leg pushes and pops. */}
      <View style={[styles.map, { backgroundColor: theme.surfaceMuted }]} testID="location-correction-map">
        {evidence && evidence !== "unavailable" ? mapReady ? (
          <Reanimated.View entering={localPresenceEntering(reduceMotion)}>
          <LocationEvidenceMap accentColor={theme.textPrimary} appearance={theme.mode === "dark" ? "dark" : "light"} clockFormat={clockFormat}
            caption={evidenceSheetCaption(evidence, { knownPlace: placeIsNamed })}
            dangerColor={theme.danger} evidence={evidence} height={SHEET_MAP_HEIGHT} reduceMotion={reduceMotion} showDetails={false} surfaceColor={theme.surfaceMuted}
            textColor={theme.textSecondary} visitOnly />
          </Reanimated.View>
        ) : null : evidence === "unavailable" ? (
          <Text {...mobileTextProps("metadata")} style={[styles.hint, styles.mapNote, { color: theme.textSecondary }]}>The map isn't available right now.</Text>
        ) : null}
      </View>
      {/* The view inside the sheet: the leg pushes in from the right and pops back from the left. */}
      <Reanimated.View
        key={leg ? `leg-${leg.startedAt}-${leg.stoppedAt}` : "main"}
        entering={FadeIn.duration(reduceMotion ? 90 : MOBILE_MOTION.control).reduceMotion(ReduceMotion.Never)
          .withInitialValues(reduceMotion ? { opacity: 0 } : { opacity: 0, transform: [{ translateX: 24 * direction }] })}
        exiting={FadeOut.duration(reduceMotion ? 70 : 120).reduceMotion(ReduceMotion.Never)}
        style={styles.view}
      >
        {placeSection ? (
          <View style={styles.section} testID="location-correction-where">
            <SheetNearbySearch awaitingCentre={evidence === null && !stale && target.kind === "place" && !target.place.placeId && correctable(item)} centre={nearbyCentre} disabled={saving} evidence={evidence && evidence !== "unavailable" ? evidence : null}
              guess={guess} onGuess={(venue, proposal) => setNearbyGuess({ venue, proposal })} onGuessPick={() => answerFromSheet(true, guess)}
              onPick={(name, applePlaceId) => savePlace(name, applePlaceId)}
              onSaveTyped={placeCanSave ? (name) => savePlace(name) : undefined}
              reduceMotion={reduceMotion} savedRows={savedRows} theme={theme} />
          </View>
        ) : null}
        {trip && leg ? (
          <LegModes mode={legMode ?? leg.mode} onPick={(mode) => { if (!frozen()) setLegMode(mode); }} theme={theme} />
        ) : null}
        {trip && !leg ? (
          <Section label="Legs" testID="location-correction-legs" theme={theme}>
              {/* Each leg its own card, as the List's legs (mock-up #ios-list trip editor). */}
              <View style={styles.legs}>
                {trip.legs.map((each, index) => {
                  const detail = legDetail(each);
                  return (
                    <Pressable key={`${each.startedAt}-${index}`} accessibilityHint="Opens it to change how you travelled"
                      accessibilityLabel={`${legModeLabel(each)}, ${time(Date.parse(each.startedAt))} to ${time(Date.parse(each.stoppedAt))}`}
                      accessibilityRole="button" onPress={() => openLeg(index)}
                      style={({ pressed }) => [styles.legCard, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}
                      testID={`location-correction-leg-${index}`}>
                      <DayframeIcon color={each.confidence === "unsure" ? theme.warningText : theme.textSecondary} glyph={DAYFRAME_LEG_MODE_ICONS[each.mode]} size={18} />
                      <View style={styles.optionText}>
                        <Text {...mobileTextProps("itemTitle")} style={[styles.optionTitle, { color: each.confidence === "unsure" ? theme.warningText : theme.textPrimary }]}>
                          {legModeLabel(each)} · {formatDuration(Math.round((Date.parse(each.stoppedAt) - Date.parse(each.startedAt)) / 1000))}
                        </Text>
                        {detail ? <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>{detail}</Text> : null}
                      </View>
                      <Text {...mobileTextProps("numeric")} style={[styles.meta, { color: theme.textSecondary }]}>{time(Date.parse(each.startedAt))}</Text>
                    </Pressable>
                  );
                })}
              </View>
          </Section>
        ) : null}
        {!leg && !correctable(item) ? (
          <Text {...mobileTextProps("metadata")} style={[styles.hint, { color: theme.textSecondary }]}>
            {target.kind === "trip" ? "This trip is in a block: its times are the block's." : "This place is in a block. Edit the block instead."}
          </Text>
        ) : null}
        {hasMore ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: moreOptions }} hitSlop={2}
            collapsable={false} onPress={toggleMore} ref={moreRow} style={({ pressed }) => [styles.more, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}
            testID="location-correction-more">
            <Text {...mobileTextProps("control")} style={[styles.moreText, { color: theme.textPrimary }]}>More options</Text>
            <View style={{ transform: [{ rotate: moreOptions ? "-90deg" : "90deg" }] }}>
              <DayframeIcon color={theme.textSecondary} glyph="chevron-right" size={16} />
            </View>
          </Pressable>
        ) : null}
        {hasMore && moreOptions ? (
          <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)}
            onLayout={() => {
              if (!revealMore.current) return;
              revealMore.current = false;
              scroller.current?.reveal(moreRow.current, "top");
            }}
            style={styles.view} testID="location-correction-more-options">
            {target.kind === "place" && logAs && !stale ? (
              // Compact activity chips; none picked logs nothing, so Clear is only a quiet way back once one is picked.
              <Section label="Logs as" testID="location-correction-logs-as" theme={theme}>
                <View accessibilityLabel="Logs as" accessibilityRole="radiogroup" style={activityChipStyles.compactWrap}>
                  {(allActivities && logAs.allActivities ? logAs.allActivities : logAs.activities).map((activity) => (
                    <ActivityChip key={activity.id} activity={activity} compact role="radio" selected={logCategoryId === activity.id}
                      onPress={() => { if (!frozen()) setLogCategoryId((current) => current === activity.id ? null : activity.id); }}
                      testID={`location-correction-log-${activity.id}`} theme={theme} />
                  ))}
                  {!allActivities && (logAs.allActivities?.length ?? 0) > logAs.activities.length ? (
                    <ShapeAction label="All activities" onPress={() => setAllActivities(true)} testID="location-correction-log-all" theme={theme} />
                  ) : null}
                </View>
                {logCategoryId ? (
                  <View style={styles.logFoot}>
                    <Text {...mobileTextProps("metadata")} style={[styles.hint, styles.logHint, { color: theme.textSecondary }]}>Fills only the time your own blocks don't cover.</Text>
                    <Pressable accessibilityRole="button" hitSlop={6} onPress={() => { if (!frozen()) setLogCategoryId(null); }}
                      style={({ pressed }) => [styles.quiet, { opacity: pressed ? 0.6 : 1 }]} testID="location-correction-log-none">
                      <Text {...mobileTextProps("control")} style={[styles.quietText, { color: theme.textSecondary }]}>Clear</Text>
                    </Pressable>
                  </View>
                ) : null}
              </Section>
            ) : null}
            {correctable(item) && item.stoppedAt ? (
              <TimesSection clockFormat={clockFormat} onChange={setTimes} onReveal={(view) => scroller.current?.reveal(view, "whole")} problem={problem} reduceMotion={reduceMotion} theme={theme} times={times} />
            ) : null}
            {target.kind === "place" ? (
              <View style={styles.corrections} testID="location-correction-corrections">
                {placeCanSave ? (
                  <View style={styles.saveRow} testID="location-correction-save-form">
                    <TextInput accessibilityLabel="Name for this place" onChangeText={(text) => { if (frozen()) return; setAttempted(null); setPlaceName(text); }} onSubmitEditing={() => savePlace()}
                      placeholder="Save this place as…" placeholderTextColor={theme.textSecondary} returnKeyType="done"
                      style={[styles.nameInput, { backgroundColor: theme.surfaceMuted, color: theme.textPrimary }]}
                      testID="location-correction-place-name" value={placeName} />
                    <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || !placeName.trim() }} hitSlop={COMPACT_PILL_HIT_SLOP}
                      disabled={saving || !placeName.trim()} onPress={() => savePlace()} testID="location-correction-confirm-save-place"
                      style={({ pressed }) => [compactPillStyles.pill, styles.savePill, { backgroundColor: theme.textPrimary, opacity: pressed || !placeName.trim() ? 0.5 : 1 }]}>
                      <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: theme.surface }]}>Save place</Text>
                    </Pressable>
                  </View>
                ) : null}
                {confirming === "not_here" && target.notHere ? (
                  <ConfirmRow confirmLabel="Take it off your day" danger message="It comes off your day, and the trips either side become one."
                    onConfirm={() => confirmJoin("not_here")} onKeep={keepAsIs} reduceMotion={reduceMotion} testID="not-here" theme={theme} />
                ) : (
                  <View style={compactPillStyles.answers}>
                    {target.notHere && !stale ? (
                      <ShapeAction danger label="I wasn't here" onPress={() => { if (!frozen()) setConfirming("not_here"); }} testID="location-correction-not-here" theme={theme} />
                    ) : null}
                  </View>
                )}
              </View>
            ) : null}
            {trip && correctable(trip) ? (
              <View style={styles.corrections} testID="location-correction-corrections">
              {confirming === "didnt_leave" && target.kind === "trip" && target.didntLeave ? (
                <ConfirmRow confirmLabel="Make it one stay" message="The trip comes off your day, and the visits either side become one stay."
                  onConfirm={() => confirmJoin("didnt_leave")} onKeep={keepAsIs} reduceMotion={reduceMotion} testID="didnt-leave" theme={theme} />
              ) : confirming === "remove" ? (
                <ConfirmRow confirmLabel="Take it off your day" danger message="It comes off your day. Nothing else changes."
                  onConfirm={() => confirmJoin("remove")} onKeep={keepAsIs} reduceMotion={reduceMotion} testID="trip" theme={theme} />
              ) : (
                <View style={compactPillStyles.answers}>
                  {target.kind === "trip" && target.didntLeave ? (
                    <ShapeAction label="I didn't leave" onPress={() => { if (!frozen()) setConfirming("didnt_leave"); }} testID="location-correction-didnt-leave" theme={theme} />
                  ) : null}
                  <ShapeAction danger label="This wasn't a trip" onPress={() => { if (!frozen()) setConfirming("remove"); }} testID="location-correction-not-a-trip" theme={theme} />
                </View>
              )}
              </View>
            ) : null}
          </Reanimated.View>
        ) : null}
        {stale ? (
          <Text {...mobileTextProps("metadata")} style={[styles.hint, { color: theme.textSecondary }]} testID="location-correction-stale">
            This changed while it was open. Close it and open it again from the List.
          </Text>
        ) : null}
        {saveError ? (
          <Text {...mobileTextProps("metadata")} accessibilityLiveRegion="polite" style={[styles.hint, { color: theme.dangerText }]}
            testID="location-correction-error">{saveError}</Text>
        ) : null}
      </Reanimated.View>
    </BottomSheetShell>
  );
}

/** A correction's compact pill: neutral, or in the danger colour for one that takes something off the day. */
function ShapeAction({ danger = false, label, onPress, testID, theme }: {
  danger?: boolean; label: string; onPress: () => void; testID: string; theme: MobileTheme;
}) {
  return (
    <Pressable accessibilityRole="button" hitSlop={COMPACT_PILL_HIT_SLOP} onPress={onPress} testID={testID}
      style={({ pressed }) => [compactPillStyles.pill, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
      <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: danger ? theme.dangerText : theme.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

/** Asked once, in place: the change, or Keep it. */
function ConfirmRow({ confirmLabel, danger = false, message, onConfirm, onKeep, reduceMotion, testID, theme }: {
  confirmLabel: string; danger?: boolean; message: string; onConfirm: () => void; onKeep: () => void; reduceMotion: boolean;
  testID: string; theme: MobileTheme;
}) {
  return (
    <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} style={styles.confirm}>
      <Text {...mobileTextProps("body")} style={[styles.hint, { color: theme.textPrimary }]}>{message}</Text>
      <View style={compactPillStyles.answers}>
        <Pressable accessibilityRole="button" hitSlop={COMPACT_PILL_HIT_SLOP} onPress={onConfirm} testID={testID === "trip" ? "location-correction-remove-trip" : `location-correction-confirm-${testID}`}
          style={({ pressed }) => [compactPillStyles.pill, { backgroundColor: danger ? theme.danger : theme.textPrimary, opacity: pressed ? 0.7 : 1 }]}>
          <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: danger ? theme.onDanger : theme.surface }]}>{confirmLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={COMPACT_PILL_HIT_SLOP} onPress={onKeep} testID={testID === "trip" ? "location-correction-keep-trip" : `location-correction-keep-${testID}`}
          style={({ pressed }) => [compactPillStyles.pill, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
          <Text {...mobileTextProps("control")} style={[compactPillStyles.text, { color: theme.textPrimary }]}>Keep it</Text>
        </Pressable>
      </View>
    </Reanimated.View>
  );
}


/** A sentence-case section (owner feedback, 29 Oct 2026: no all-caps headers); a section may have no title. */
function Section({ children, hint, label, testID, theme }: {
  children: React.ReactNode; hint?: string; label: string | null; testID?: string; theme: MobileTheme;
}) {
  return (
    <View style={styles.section} testID={testID}>
      {label ? <Text {...mobileTextProps("itemTitle")} accessibilityRole="header" style={[styles.label, { color: theme.textPrimary }]}>{label}</Text> : null}
      {children}
      {hint ? <Text {...mobileTextProps("metadata")} style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

function LegModes({ mode, onPick, theme }: { mode: TripLegMode; onPick: (mode: TripLegMode) => void; theme: MobileTheme }) {
  return (
    <Section label="How did you travel?" theme={theme}>
      <View accessibilityRole="radiogroup" accessibilityLabel="How you travelled" style={styles.modes}>
        {LEG_MODES.map((each) => {
          const on = each === mode;
          return (
            <Pressable key={each} accessibilityLabel={LEG_MODE_LABEL[each]} accessibilityRole="radio" accessibilityState={{ checked: on }}
              onPress={() => onPick(each)} testID={`location-correction-mode-${each}`}
              style={({ pressed }) => [styles.mode, { backgroundColor: on ? theme.textPrimary : theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
              <DayframeIcon color={on ? theme.background : theme.textPrimary} glyph={DAYFRAME_LEG_MODE_ICONS[each]} size={20} />
              <Text {...mobileTextProps("metadata")} adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={[styles.modeText, { color: on ? theme.background : theme.textPrimary }]}>{LEG_MODE_LABEL[each]}</Text>
            </Pressable>
          );
        })}
      </View>
    </Section>
  );
}

function TimesSection({ clockFormat, onChange, onReveal, problem, reduceMotion, theme, times }: {
  clockFormat: ClockFormat; onChange: (times: CorrectionTimes) => void; onReveal: (view: View | null) => void; problem: string | null; reduceMotion: boolean;
  theme: MobileTheme; times: CorrectionTimes;
}) {
  // The wheel serves one field at a time; a second tap on the field closes it (as the Location editor).
  const [wheel, setWheel] = useState<{ target: "start" | "end"; presentationId: number } | null>(null);
  const [revision, setRevision] = useState(0);
  const presentations = useRef(0);
  const box = useRef<View | null>(null);
  const value = (target: "start" | "end") => target === "start" ? times.startMs : times.stopMs ?? times.startMs;
  const set = (target: "start" | "end", ms: number) => onChange(target === "start" ? { ...times, startMs: ms } : { ...times, stopMs: ms });

  function toggle(target: "start" | "end") {
    if (wheel?.target === target) {
      setWheel(null);
      playHaptic("timeSet");
      return;
    }
    if (!wheel) presentations.current += 1;
    setWheel({ target, presentationId: wheel?.presentationId ?? presentations.current });
    setRevision((current) => current + 1);
    // Moving to the other time keeps the height, so no layout says so.
    if (wheel) onReveal(box.current);
  }

  function step(target: "start" | "end", direction: 1 | -1, minutes: 1 | 5) {
    const next = timeWheelAccessibilityStep(value(target), direction, {}, minutes);
    if (next === null) return;
    set(target, next);
    setRevision((current) => current + 1);
  }

  function changed(change: DayframeTimeWheelChange) {
    if (!wheel || change.presentationId !== wheel.presentationId || change.revision !== revision || !Number.isFinite(change.valueMs)) return;
    set(wheel.target, change.valueMs);
  }

  return (
    <Section label={null} testID="location-correction-times" theme={theme} hint={problem ?? undefined}>
      {/* The times and their one wheel: opening it scrolls all of it into view above the footer. */}
      <View collapsable={false} onLayout={() => { if (wheel) onReveal(box.current); }} ref={box} style={styles.section}>
      <View style={styles.times}>
        {(["start", "end"] as const).map((target) => (
          <Pressable key={target} accessibilityActions={TIME_FIELD_ACCESSIBILITY_ACTIONS} accessibilityLabel={target === "start" ? "Start" : "End"}
            accessibilityRole="adjustable" accessibilityState={{ expanded: wheel?.target === target }}
            accessibilityValue={{ text: formatClockTime(new Date(value(target)), clockFormat) }}
            onAccessibilityAction={(event) => {
              const name = event.nativeEvent.actionName;
              if (name === "increment") step(target, 1, 5);
              else if (name === "decrement") step(target, -1, 5);
              else if (name === "plusMinute") step(target, 1, 1);
              else if (name === "minusMinute") step(target, -1, 1);
              else if (name === "activate") toggle(target);
            }}
            onPress={() => toggle(target)}
            style={[styles.timeCard, { backgroundColor: wheel?.target === target ? theme.surfaceInset : theme.surfaceMuted }]}
            testID={`location-correction-${target}`}>
            <Text {...mobileTextProps("metadata")} style={[styles.fieldLabel, { color: theme.textSecondary }]}>{target === "start" ? "Start" : "End"}</Text>
            <Text {...mobileTextProps("numeric")} style={[styles.timeValue, { color: theme.textPrimary }]}>{formatClockTime(new Date(value(target)), clockFormat)}</Text>
          </Pressable>
        ))}
      </View>
      {wheel ? (
        <TimeWheelPanel
          key={`location-correction-wheel-${wheel.presentationId}`}
          model={{
            clockFormat,
            colorScheme: theme.mode === "dark" ? "dark" : "light",
            maximumMs: null,
            minimumMs: null,
            minuteInterval: 1,
            modelVersion: 1,
            presentationId: wheel.presentationId,
            revision,
            valueMs: value(wheel.target)
          }}
          notch={wheel.target === "start" ? "25%" : "75%"}
          onTimeChange={changed}
          reduceMotion={reduceMotion}
          testIDPrefix="location-correction-time-wheel"
          theme={theme}
          wheelHeight={180}
        />
      ) : null}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  ask: { fontSize: 15, lineHeight: 20 },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 8 },
  headText: { flex: 1, gap: 2 },
  round: { width: 36, height: 36, borderRadius: DAYFRAME_BLOCKS.radius.pill, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", lineHeight: 25 },
  meta: { fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] },
  view: { gap: 14 },
  map: { height: SHEET_MAP_HEIGHT, borderRadius: 14, overflow: "hidden", justifyContent: "center", marginBottom: 10 },
  mapNote: { textAlign: "center", padding: 16 },
  section: { gap: 8 },
  // Sentence-case titles, sparingly (owner feedback, 29 Oct 2026).
  label: { fontSize: 15, fontWeight: "650" as never, lineHeight: 20 },
  fieldLabel: { fontSize: 13, fontWeight: "600" },
  more: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, paddingHorizontal: 14 },
  moreText: { fontSize: 15, fontWeight: "600" },
  logFoot: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 },
  logHint: { flex: 1 },
  // Clear: quiet text, never a filled pill.
  quiet: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  quietText: { fontSize: 15, fontWeight: "600" },
  corrections: { gap: 14 },
  hint: { fontSize: 13, lineHeight: 18 },
  optionText: { flex: 1, gap: 1 },
  optionTitle: { fontSize: 16, fontWeight: "600", lineHeight: 21 },
  modes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  // Four square tiles a row, the icon over its name (mock-up #ios-list leg editor).
  mode: { width: "23%", flexGrow: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 4, borderRadius: 14 },
  modeText: { fontSize: 12.5, fontWeight: "600", textAlign: "center" },
  legs: { gap: 4 },
  legCard: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14 },
  times: { flexDirection: "row", gap: 10 },
  // Slim and fill-led: the fill says which field the wheel is on.
  timeCard: { flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  timeValue: { fontSize: 16, fontWeight: "600", fontVariant: ["tabular-nums"] },
  confirm: { gap: 10 },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  nameInput: { flex: 1, minHeight: 44, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  savePill: { alignSelf: "center" }
});
