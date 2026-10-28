import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Reanimated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";
import {
  DAYFRAME_APP_ICONS,
  DAYFRAME_BLOCKS,
  DAYFRAME_LEG_MODE_ICONS,
  LEG_MODE_LABEL,
  formatClockTime,
  formatDuration,
  legDetail,
  legModeLabel,
  type ClockFormat,
  type DayframeGlyph,
  type TimelineItemEvidenceDto,
  type TimelinePlace,
  type TimelineTrip,
  type TripLegMode
} from "@dayframe/shared";
import type { DayframeTimeWheelChange } from "../../../modules/dayframe-time-wheel";
import { BottomSheetShell } from "../sheets/BottomSheetShell";
import { TimeWheelPanel } from "../TimeWheelPanel";
import { DayframeIcon } from "../icons/DayframeIcon";
import { LocationEvidenceMap } from "../location/LocationEvidenceMap";
import { playHaptic } from "../../lib/haptics";
import { MOBILE_MOTION, localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
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
 * The iPhone correction sheets (location v4 step 12, mock-up #ios-list editors): a place's place and times;
 * a trip's legs, times and "This wasn't a trip"; a leg's mode, pushed inside the trip sheet with a back
 * button. One `BottomSheetShell` owns presentation (its spring in, its swipe or backdrop out, Done pinned at
 * the bottom); the leg view pushes and pops inside it with a short fade-and-slide (a fade with Reduce
 * Motion). Done queues only what changed (`locationCorrectionDraft`): the List shows it at once and the
 * correction queue sends it. Only what the timeline API can set is offered; nothing here names a place from
 * Apple Maps (card B part 2).
 */

/** `notHere` / `didntLeave`: whether the List lets "I wasn't here" or "I didn't leave" join its neighbours (step 12 part 4). */
export type LocationCorrectionTarget =
  | { kind: "place"; place: TimelinePlace; label: string; notHere?: boolean }
  | { kind: "trip"; trip: TimelineTrip & { route?: string }; legIndex: number | null; didntLeave?: boolean };

type Join = "remove" | "not_here" | "didnt_leave";
type Confirming = Join | "save_place";

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
  places,
  presentationId,
  reduceMotion,
  rootHosted,
  stale = false,
  target,
  theme
}: {
  clockFormat: ClockFormat;
  /** The item's map: null while it loads, "unavailable" when it couldn't be read. */
  evidence: TimelineItemEvidenceDto | "unavailable" | null;
  onDismissed: (presentationId: number) => void;
  /**
   * Keeps these corrections on the phone and sends them (the List shows them at once). Resolves once they are
   * kept: the sheet closes only then, and keeps its draft when they couldn't be (Codex r1 on #602).
   */
  onQueue: (corrections: QueuedCorrection[], options: { closing: boolean }) => Promise<void>;
  /**
   * "Save this place" (step 12 part 4, card D item 14): saves the visit's place under this name and sets the
   * visit to it; absent when it can't be offered (a named place, a block, or no map to place it by).
   */
  onSavePlace?: (name: string) => Promise<void>;
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
  function keep(corrections: QueuedCorrection[], then: "close" | "trip") {
    setSaving(true);
    setSaveError(null);
    onQueue(corrections, { closing: then === "close" }).then(() => {
      setSaving(false);
      if (then === "trip") {
        backToTrip();
        return;
      }
      kept.current = true;
      setCloseKept(true);
    }, () => {
      intent.current = null;
      setSaving(false);
      setSaveError("That change couldn't be kept on this iPhone. Try again.");
    });
  }

  function apply() {
    if (kept.current) return true;
    if (stale || saving) return false;
    if (intent.current) {
      const change = intent.current === "remove" && trip ? notATrip(trip)
        : intent.current === "didnt_leave" && trip ? didntLeave(trip)
          : intent.current === "not_here" && target.kind === "place" ? notHere(target.place) : null;
      if (!change) {
        intent.current = null;
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
    const corrections = target.kind === "place"
      ? placeCorrections(target.place, { choice, times }, places)
      : tripCorrections(target.trip, { times });
    if (!corrections.length) return true;
    keep(corrections, "close");
    return false;
  }

  // "This wasn't a trip", "I wasn't here" and "I didn't leave" each ask once, in place (UIA-005: no system alert).
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [placeName, setPlaceName] = useState("");
  function savePlace() {
    if (!onSavePlace || !placeName.trim() || saving) return;
    setSaving(true);
    setSaveError(null);
    onSavePlace(placeName.trim()).then(() => {
      setSaving(false);
      kept.current = true;
      setCloseKept(true);
    }, () => {
      setSaving(false);
      setSaveError("That place couldn't be saved. Saving a place needs a connection; try again.");
    });
  }
  function confirmJoin(join: Join) {
    intent.current = join;
    commitRef.current?.();
  }
  function keepAsIs() {
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

  return (
    <BottomSheetShell
      action="Done"
      actionTone="neutral"
      calendarLayout={false}
      commitRef={commitRef}
      // A removal or join needs no valid times; nothing changes while a change is being kept, or once the item
      // left. A kept change always closes.
      disabled={!closeKept && (stale || saving || (!leg && !confirming && Boolean(problem)))}
      onApply={apply}
      onDismissed={onDismissed}
      presentationId={presentationId}
      reduceMotion={reduceMotion}
      rootHosted={rootHosted}
      testID="location-correction-sheet"
      theme={theme}
      title={title}
    >
      <View style={styles.head}>
        {leg ? (
          <Pressable accessibilityLabel="Back to the trip" accessibilityRole="button" hitSlop={6} onPress={backToTrip}
            style={[styles.back, { backgroundColor: theme.surfaceMuted }]} testID="location-correction-back">
            <DayframeIcon color={theme.textPrimary} glyph="arrow-left" size={18} />
          </Pressable>
        ) : null}
        <View style={styles.headText}>
          <Text {...mobileTextProps("sectionHeading")} accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
          <Text {...mobileTextProps("metadata")} style={[styles.meta, { color: theme.textSecondary }]}>{subtitle}</Text>
        </View>
      </View>
      {/* The map first, on every view (owner feedback, 27 Oct 2026); it stays put as a leg pushes and pops. */}
      <View style={[styles.map, { backgroundColor: theme.surfaceMuted }]} testID="location-correction-map">
        {evidence && evidence !== "unavailable" ? (
          <LocationEvidenceMap accentColor={theme.textPrimary} appearance={theme.mode === "dark" ? "dark" : "light"} clockFormat={clockFormat}
            dangerColor={theme.danger} evidence={evidence} reduceMotion={reduceMotion} showDetails={false} surfaceColor={theme.surfaceMuted}
            textColor={theme.textSecondary} />
        ) : (
          <Text {...mobileTextProps("metadata")} style={[styles.hint, styles.mapNote, { color: theme.textSecondary }]}>
            {evidence === "unavailable" ? "The map isn't available right now." : "Loading the map…"}
          </Text>
        )}
      </View>
      {/* The view inside the sheet: the leg pushes in from the right and pops back from the left. */}
      <Reanimated.View
        key={leg ? `leg-${leg.startedAt}-${leg.stoppedAt}` : "main"}
        entering={FadeIn.duration(reduceMotion ? 90 : MOBILE_MOTION.control).reduceMotion(ReduceMotion.Never)
          .withInitialValues(reduceMotion ? { opacity: 0 } : { opacity: 0, transform: [{ translateX: 24 * direction }] })}
        exiting={FadeOut.duration(reduceMotion ? 70 : 120).reduceMotion(ReduceMotion.Never)}
        style={styles.view}
      >
        {target.kind === "place" ? (
          <PlaceView choice={choice} correctableItem={correctable(target.place)} onChoose={(next) => { if (!frozen()) setChoice(next); }} place={target.place}
            places={places} theme={theme} />
        ) : null}
        {trip && leg ? (
          <LegModes mode={legMode ?? leg.mode} onPick={(mode) => { if (!frozen()) setLegMode(mode); }} theme={theme} />
        ) : null}
        {trip && !leg ? (
          <Section label="Legs" theme={theme} hint="Tap a leg to change how you travelled.">
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
        {!leg && correctable(item) && item.stoppedAt ? (
          <TimesSection clockFormat={clockFormat} onChange={setTimes} problem={problem} reduceMotion={reduceMotion}
            hint={target.kind === "trip" ? "The places either side move with it." : "Moving an edge moves the trip next to it."}
            theme={theme} times={times} />
        ) : null}
        {!leg && !correctable(item) ? (
          <Text {...mobileTextProps("metadata")} style={[styles.hint, { color: theme.textSecondary }]}>
            {target.kind === "trip" ? "This trip is in a block: its times are the block's." : "This place is in a block. Edit the block instead."}
          </Text>
        ) : null}
        {target.kind === "place" && (target.notHere || onSavePlace) && !stale ? (
          <Section label="Fix the shape" theme={theme}>
            {confirming === "not_here" ? (
              <ConfirmRow confirmLabel="Take it off your day" danger message="It comes off your day, and the trips either side become one."
                onConfirm={() => confirmJoin("not_here")} onKeep={keepAsIs} reduceMotion={reduceMotion} testID="not-here" theme={theme} />
            ) : confirming === "save_place" ? (
              <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} style={styles.confirm}>
                <TextInput accessibilityLabel="Name of this place" autoFocus onChangeText={setPlaceName} onSubmitEditing={savePlace}
                  placeholder="Name this place" placeholderTextColor={theme.textSecondary} returnKeyType="done"
                  style={[styles.nameInput, { backgroundColor: theme.surfaceMuted, color: theme.textPrimary }]}
                  testID="location-correction-place-name" value={placeName} />
                <View style={styles.pills}>
                  <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving || !placeName.trim() }}
                    disabled={saving || !placeName.trim()} onPress={savePlace} testID="location-correction-confirm-save-place"
                    style={({ pressed }) => [styles.pill, { backgroundColor: theme.textPrimary, opacity: pressed || !placeName.trim() ? 0.5 : 1 }]}>
                    <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.surface }]}>Save this place</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={keepAsIs} testID="location-correction-keep-save-place"
                    style={({ pressed }) => [styles.pill, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
                    <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.textPrimary }]}>Keep it</Text>
                  </Pressable>
                </View>
              </Reanimated.View>
            ) : (
              <View style={styles.pills}>
                {onSavePlace ? (
                  <ShapeAction label="Save this place" onPress={() => setConfirming("save_place")} testID="location-correction-save-place" theme={theme} />
                ) : null}
                {target.notHere ? (
                  <ShapeAction danger label="I wasn't here" onPress={() => setConfirming("not_here")} testID="location-correction-not-here" theme={theme} />
                ) : null}
              </View>
            )}
          </Section>
        ) : null}
        {trip && !leg && correctable(trip) ? (
          <Section label="Fix the shape" theme={theme}>
            {confirming === "didnt_leave" ? (
              <ConfirmRow confirmLabel="Make it one stay" message="The trip comes off your day, and the visits either side become one stay."
                onConfirm={() => confirmJoin("didnt_leave")} onKeep={keepAsIs} reduceMotion={reduceMotion} testID="didnt-leave" theme={theme} />
            ) : confirming === "remove" ? (
              <ConfirmRow confirmLabel="Take it off your day" danger message="It comes off your day. Nothing else changes."
                onConfirm={() => confirmJoin("remove")} onKeep={keepAsIs} reduceMotion={reduceMotion} testID="trip" theme={theme} />
            ) : (
              <View style={styles.pills}>
                {target.kind === "trip" && target.didntLeave ? (
                  <ShapeAction label="I didn't leave" onPress={() => setConfirming("didnt_leave")} testID="location-correction-didnt-leave" theme={theme} />
                ) : null}
                <ShapeAction danger label="This wasn't a trip" onPress={() => setConfirming("remove")} testID="location-correction-not-a-trip" theme={theme} />
              </View>
            )}
          </Section>
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

/** A "Fix the shape" pill: neutral, or in the danger colour for one that takes something off the day. */
function ShapeAction({ danger = false, label, onPress, testID, theme }: {
  danger?: boolean; label: string; onPress: () => void; testID: string; theme: MobileTheme;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID}
      style={({ pressed }) => [styles.pill, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
      <Text {...mobileTextProps("control")} style={[styles.pillText, { color: danger ? theme.dangerText : theme.textPrimary }]}>{label}</Text>
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
      <View style={styles.pills}>
        <Pressable accessibilityRole="button" onPress={onConfirm} testID={testID === "trip" ? "location-correction-remove-trip" : `location-correction-confirm-${testID}`}
          style={({ pressed }) => [styles.pill, { backgroundColor: danger ? theme.danger : theme.textPrimary, opacity: pressed ? 0.7 : 1 }]}>
          <Text {...mobileTextProps("control")} style={[styles.pillText, { color: danger ? theme.onDanger : theme.surface }]}>{confirmLabel}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onKeep} testID={testID === "trip" ? "location-correction-keep-trip" : `location-correction-keep-${testID}`}
          style={({ pressed }) => [styles.pill, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
          <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.textPrimary }]}>Keep it</Text>
        </Pressable>
      </View>
    </Reanimated.View>
  );
}

function Section({ children, hint, label, theme }: { children: React.ReactNode; hint?: string; label: string; theme: MobileTheme }) {
  return (
    <View style={styles.section}>
      <Text {...mobileTextProps("metadata")} accessibilityRole="header" style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      {children}
      {hint ? <Text {...mobileTextProps("metadata")} style={[styles.hint, { color: theme.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

function PlaceView({ choice, correctableItem, onChoose, place, places, theme }: {
  choice: PlaceChoice; correctableItem: boolean; onChoose: (choice: PlaceChoice) => void; place: TimelinePlace;
  places: readonly CorrectionPlaceOption[]; theme: MobileTheme;
}) {
  if (!correctableItem) return null;
  // What is ticked: the pick, or the place as it is (its saved place, or unknown).
  const selected = choice.kind === "saved" ? choice.id : choice.kind === "unknown" ? null
    : place.placeId ?? (place.learnedPlaceId ? "learned" : null);
  const options: Array<{ key: string; title: string; detail: string; glyph: DayframeGlyph; pick: PlaceChoice }> = [
    ...(place.learnedPlaceId && place.name
      ? [{ key: "learned", title: place.name, detail: "Named before", glyph: DAYFRAME_APP_ICONS.places as DayframeGlyph, pick: { kind: "keep" } as PlaceChoice }]
      : []),
    ...places.map((option) => ({
      key: option.id,
      title: option.name,
      detail: "Saved place",
      glyph: (option.role === "home" ? "house" : DAYFRAME_APP_ICONS.places) as DayframeGlyph,
      pick: { kind: "saved", id: option.id } as PlaceChoice
    })),
    { key: "unknown", title: "Leave as unknown", detail: "Keeps its “?” until you name it", glyph: "circle-question-mark" as DayframeGlyph, pick: { kind: "unknown" } }
  ];
  return (
    <Section label="Where were you?" theme={theme}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Place" style={[styles.group, { backgroundColor: theme.surfaceMuted }]}>
        {options.map((option, index) => {
          const checked = option.key === "unknown" ? selected === null : selected === option.key;
          return (
            <Pressable key={option.key} accessibilityLabel={`${option.title}, ${option.detail}`} accessibilityRole="radio"
              accessibilityState={{ checked }} onPress={() => onChoose(option.pick)}
              style={({ pressed }) => [styles.option, index > 0 ? [styles.divided, { borderTopColor: theme.border }] : null, { opacity: pressed ? 0.7 : 1 }]}
              testID={`location-correction-place-${option.key}`}>
              <DayframeIcon color={theme.textSecondary} glyph={option.glyph} size={18} />
              <View style={styles.optionText}>
                <Text {...mobileTextProps("itemTitle")} numberOfLines={1} style={[styles.optionTitle, { color: theme.textPrimary }]}>{option.title}</Text>
                <Text {...mobileTextProps("metadata")} numberOfLines={1} style={[styles.meta, { color: theme.textSecondary }]}>{option.detail}</Text>
              </View>
              {checked ? <DayframeIcon color={theme.textPrimary} glyph="check" size={16} /> : <View style={styles.tickSpace} />}
            </Pressable>
          );
        })}
      </View>
    </Section>
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

function TimesSection({ clockFormat, hint, onChange, problem, reduceMotion, theme, times }: {
  clockFormat: ClockFormat; hint: string; onChange: (times: CorrectionTimes) => void; problem: string | null; reduceMotion: boolean;
  theme: MobileTheme; times: CorrectionTimes;
}) {
  // The wheel serves one field at a time; a second tap on the field closes it (as the Location editor).
  const [wheel, setWheel] = useState<{ target: "start" | "end"; presentationId: number } | null>(null);
  const [revision, setRevision] = useState(0);
  const presentations = useRef(0);
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
    <Section label="Times" theme={theme} hint={problem ?? hint}>
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
            style={[styles.timeCard, { backgroundColor: theme.surfaceMuted, borderColor: wheel?.target === target ? theme.textPrimary : "transparent" }]}
            testID={`location-correction-${target}`}>
            <View style={styles.timeText}>
              <Text {...mobileTextProps("metadata")} style={[styles.label, { color: theme.textSecondary }]}>{target === "start" ? "Start" : "End"}</Text>
              <Text {...mobileTextProps("numeric")} style={[styles.timeValue, { color: theme.textPrimary }]}>{formatClockTime(new Date(value(target)), clockFormat)}</Text>
            </View>
            <DayframeIcon color={theme.textSecondary} glyph="clock" size={18} />
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
    </Section>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingBottom: 6 },
  headText: { flex: 1, gap: 2 },
  back: { width: 44, height: 44, borderRadius: DAYFRAME_BLOCKS.radius.pill, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "700", lineHeight: 25 },
  meta: { fontSize: 13, lineHeight: 18, fontVariant: ["tabular-nums"] },
  view: { gap: 18 },
  map: { minHeight: 180, borderRadius: 14, overflow: "hidden", justifyContent: "center", marginBottom: 6 },
  mapNote: { textAlign: "center", padding: 16 },
  section: { gap: 8 },
  label: { fontSize: 12, fontWeight: "650" as never, letterSpacing: 0.4, textTransform: "uppercase" },
  hint: { fontSize: 13, lineHeight: 18 },
  group: { borderRadius: 14, overflow: "hidden" },
  option: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8 },
  divided: { borderTopWidth: StyleSheet.hairlineWidth },
  optionText: { flex: 1, gap: 1 },
  optionTitle: { fontSize: 16, fontWeight: "600", lineHeight: 21 },
  tickSpace: { width: 16 },
  modes: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  // Four square tiles a row, the icon over its name (mock-up #ios-list leg editor).
  mode: { width: "23%", flexGrow: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 4, borderRadius: 14 },
  modeText: { fontSize: 12.5, fontWeight: "600", textAlign: "center" },
  legs: { gap: 4 },
  legCard: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14 },
  times: { flexDirection: "row", gap: 10 },
  timeCard: { flex: 1, minHeight: 60, borderRadius: 14, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 8, flexDirection: "row", alignItems: "center" },
  timeText: { flex: 1, gap: 2 },
  timeValue: { fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  pill: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 18, borderRadius: DAYFRAME_BLOCKS.radius.pill },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  confirm: { gap: 10 },
  nameInput: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, fontSize: 17 },
  pillText: { fontSize: 15, fontWeight: "600" }
});
