import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
  type TimelinePlace,
  type TimelineTrip,
  type TripLegMode
} from "@dayframe/shared";
import type { DayframeTimeWheelChange } from "../../../modules/dayframe-time-wheel";
import { BottomSheetShell } from "../sheets/BottomSheetShell";
import { TimeWheelPanel } from "../TimeWheelPanel";
import { DayframeIcon } from "../icons/DayframeIcon";
import { playHaptic } from "../../lib/haptics";
import { MOBILE_MOTION, localPresenceEntering, localPresenceExiting } from "../../lib/motion";
import type { MobileTheme } from "../../lib/mobileTheme";
import { mobileTextProps } from "../../lib/mobileTypography";
import { timeWheelAccessibilityStep } from "../../lib/timeWheel";
import {
  correctable,
  legCorrection,
  notATrip,
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

export type LocationCorrectionTarget =
  | { kind: "place"; place: TimelinePlace; label: string }
  | { kind: "trip"; trip: TimelineTrip & { route?: string }; legIndex: number | null };

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
  onDismissed,
  onQueue,
  places,
  presentationId,
  reduceMotion,
  rootHosted,
  target,
  theme
}: {
  clockFormat: ClockFormat;
  onDismissed: (presentationId: number) => void;
  /** Keeps these corrections on the phone and sends them (the List shows them at once). */
  onQueue: (corrections: QueuedCorrection[]) => void;
  /** The saved places, for "Where were you?". */
  places: readonly CorrectionPlaceOption[];
  presentationId: number;
  reduceMotion: boolean;
  rootHosted: boolean;
  target: LocationCorrectionTarget;
  theme: MobileTheme;
}) {
  const item = target.kind === "place" ? target.place : target.trip;
  const [choice, setChoice] = useState<PlaceChoice>({ kind: "keep" });
  const [times, setTimes] = useState<CorrectionTimes>({
    startMs: Date.parse(item.startedAt),
    stopMs: item.stoppedAt ? Date.parse(item.stoppedAt) : null
  });
  // The leg shown, pushed inside the trip sheet; its picked mode until its Done.
  const [legIndex, setLegIndex] = useState<number | null>(target.kind === "trip" ? target.legIndex : null);
  const [legMode, setLegMode] = useState<TripLegMode | null>(null);
  // Which way the last push went, for the leg view's slide.
  const [direction, setDirection] = useState<1 | -1>(1);
  // Opened at a leg from the List: its Done closes the sheet, unless the person went back to the trip.
  const [leftLeg, setLeftLeg] = useState(false);
  const commitRef = useRef<(() => void) | null>(null);
  const deleting = useRef(false);
  const time = (ms: number) => formatClockTime(new Date(ms), clockFormat);
  const span = `${time(Date.parse(item.startedAt))}–${item.stoppedAt ? time(Date.parse(item.stoppedAt)) : "now"}`;
  const problem = correctable(item) ? timesProblem(item, times) : null;
  const trip = target.kind === "trip" ? target.trip : null;
  const leg = trip && legIndex != null ? trip.legs[legIndex] ?? null : null;

  function openLeg(index: number) {
    setDirection(1);
    setLegMode(null);
    setLegIndex(index);
  }

  function backToTrip() {
    setLeftLeg(true);
    setDirection(-1);
    setLegMode(null);
    setLegIndex(null);
  }

  function apply() {
    if (deleting.current && trip) {
      const removal = notATrip(trip);
      if (removal) onQueue([removal]);
      return true;
    }
    if (trip && leg && legIndex != null) {
      // A leg's Done sends its mode and goes back to the trip; the trip's own Done closes the sheet.
      const change = legMode ? legCorrection(trip, legIndex, legMode) : null;
      if (change) {
        onQueue([change]);
        playHaptic("timeSet");
      }
      if (target.kind === "trip" && target.legIndex != null && !leftLeg) return true;
      backToTrip();
      return false;
    }
    if (problem) return false;
    const corrections = target.kind === "place"
      ? placeCorrections(target.place, { choice, times }, places)
      : tripCorrections(target.trip, { times });
    if (corrections.length) onQueue(corrections);
    return true;
  }

  // "This wasn't a trip" asks once, in place (UIA-005: no system alert): Take it off your day, or Keep it.
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  function removeTrip() {
    deleting.current = true;
    commitRef.current?.();
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
      calendarLayout={false}
      commitRef={commitRef}
      disabled={!leg && Boolean(problem)}
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
      {/* The view inside the sheet: the leg pushes in from the right and pops back from the left. */}
      <Reanimated.View
        key={leg ? `leg-${legIndex}` : "main"}
        entering={FadeIn.duration(reduceMotion ? 90 : MOBILE_MOTION.control).reduceMotion(ReduceMotion.Never)
          .withInitialValues(reduceMotion ? { opacity: 0 } : { opacity: 0, transform: [{ translateX: 24 * direction }] })}
        exiting={FadeOut.duration(reduceMotion ? 70 : 120).reduceMotion(ReduceMotion.Never)}
        style={styles.view}
      >
        {target.kind === "place" ? (
          <PlaceView choice={choice} correctableItem={correctable(target.place)} onChoose={setChoice} place={target.place}
            places={places} theme={theme} />
        ) : null}
        {trip && leg ? (
          <LegModes mode={legMode ?? leg.mode} onPick={setLegMode} theme={theme} />
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
        {trip && !leg && correctable(trip) ? (
          <Section label="Fix the shape" theme={theme}>
            {confirmingRemoval ? (
              <Reanimated.View entering={localPresenceEntering(reduceMotion)} exiting={localPresenceExiting(reduceMotion)} style={styles.confirm}>
                <Text {...mobileTextProps("body")} style={[styles.hint, { color: theme.textPrimary }]}>It comes off your day. Nothing else changes.</Text>
                <View style={styles.pills}>
                  <Pressable accessibilityRole="button" onPress={removeTrip} testID="location-correction-remove-trip"
                    style={({ pressed }) => [styles.pill, { backgroundColor: theme.danger, opacity: pressed ? 0.7 : 1 }]}>
                    <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.onDanger }]}>Take it off your day</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => setConfirmingRemoval(false)} testID="location-correction-keep-trip"
                    style={({ pressed }) => [styles.pill, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}>
                    <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.textPrimary }]}>Keep it</Text>
                  </Pressable>
                </View>
              </Reanimated.View>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setConfirmingRemoval(true)}
                style={({ pressed }) => [styles.pill, { backgroundColor: theme.surfaceMuted, opacity: pressed ? 0.7 : 1 }]}
                testID="location-correction-not-a-trip">
                <Text {...mobileTextProps("control")} style={[styles.pillText, { color: theme.dangerText }]}>This wasn't a trip</Text>
              </Pressable>
            )}
          </Section>
        ) : null}
      </Reanimated.View>
    </BottomSheetShell>
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
      detail: option.role === "home" ? "Home" : option.role === "work" ? "Work" : "Saved place",
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
  pillText: { fontSize: 15, fontWeight: "600" }
});
