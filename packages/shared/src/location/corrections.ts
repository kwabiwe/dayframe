import { z } from "zod";
import { mergeSameModeLegs } from "./legs";
import type { CommuteSegment, LocationSegment, StaySegment, TripLeg, TripLegMode } from "./types";

/**
 * Timeline corrections (location v4 §4, §14; build step 11): what the person set on their location
 * timeline, tied to the time it covers and applied again by every replay. A corrected item shows "You
 * set this" and replay never changes it. Part 1 handles a place's place and times, a trip's times, a
 * trip that wasn't one, and a leg's mode; step 12 part 4 adds a place you weren't at ("I wasn't here",
 * a place's delete) and a trip you didn't take between two visits to one place ("I didn't leave", a
 * trip's merge). Split, leg boundary, leg split and leg merge come with step 16. Never coordinates.
 */

export const TIMELINE_CORRECTION_SUBJECTS = ["place", "trip", "leg"] as const;
export const TIMELINE_CORRECTION_KINDS = [
  "place", "times", "merge", "split", "delete", "leg_mode", "leg_boundary", "leg_split", "leg_merge"
] as const;
export type TimelineCorrectionSubject = (typeof TIMELINE_CORRECTION_SUBJECTS)[number];
export type TimelineCorrectionKind = (typeof TIMELINE_CORRECTION_KINDS)[number];

const LEG_MODES = ["walking", "running", "cycling", "automotive", "bus", "train", "underground", "tram"] as const satisfies readonly TripLegMode[];
const instant = z.string().datetime({ offset: true });
const itemId = z.string().min(1).max(200);
/**
 * The app's own id for one correction, so a retry after a lost reply is answered with the correction it
 * already made instead of being applied again (the iPhone's correction queue, step 12). Optional.
 */
const clientCorrectionId = z.string().uuid().optional();

/** One correction the app sends: the item it is about (its timeline id) and what the person set. */
export const TimelineCorrectionRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("place"),
    subject: z.literal("place"),
    itemId,
    clientCorrectionId,
    placeId: z.string().uuid().nullable(),
    learnedPlaceId: z.string().uuid().nullable()
  }).refine((value) => !(value.placeId && value.learnedPlaceId), { message: "Choose a saved place or a learned place, not both." }),
  z.object({
    kind: z.literal("times"),
    subject: z.enum(["place", "trip"]),
    itemId,
    clientCorrectionId,
    startedAt: instant,
    stoppedAt: instant
  }).refine((value) => Date.parse(value.stoppedAt) > Date.parse(value.startedAt), { message: "The end must be after the start." }),
  // A trip that wasn't one; a place you weren't at, whose trips either side become one (step 12 part 4).
  z.object({ kind: z.literal("delete"), subject: z.enum(["place", "trip"]), itemId, clientCorrectionId }),
  // "I didn't leave": the trip between two visits to one place, which become one stay (step 12 part 4).
  z.object({ kind: z.literal("merge"), subject: z.literal("trip"), itemId, clientCorrectionId }),
  // "Logs as" (step 12 part 4): a place with no question and no block, logged with this activity for the time
  // the person's own blocks don't cover. Blocks, not a stored correction: replay never applies it again.
  z.object({ kind: z.literal("log_place"), subject: z.literal("place"), itemId, clientCorrectionId, categoryId: z.string().uuid() }),
  z.object({
    kind: z.literal("leg_mode"),
    subject: z.literal("leg"),
    itemId,
    clientCorrectionId,
    legStartedAt: instant,
    legStoppedAt: instant,
    mode: z.enum(LEG_MODES)
  }).refine((value) => Date.parse(value.legStoppedAt) > Date.parse(value.legStartedAt), { message: "The leg's end must be after its start." })
]);
export type TimelineCorrectionRequest = z.infer<typeof TimelineCorrectionRequestSchema>;

/** A stored, active correction: its span, and its target (place IDs, times or a mode). */
export type TimelineCorrection = {
  id: string;
  subject: TimelineCorrectionSubject;
  kind: TimelineCorrectionKind;
  spanStartedAt: string;
  spanStoppedAt: string;
  target: {
    placeId?: string | null;
    learnedPlaceId?: string | null;
    startedAt?: string;
    stoppedAt?: string;
    mode?: TripLegMode;
  };
  createdAt: string;
};

const ms = (value: string) => Date.parse(value);
const overlapMs = (aFrom: number, aTo: number, bFrom: number, bTo: number) => Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));

/** The item a correction is about: the one of these overlapping its span most, when it covers at least half of the span. */
function bestOverlap<T extends { startedAt: string; stoppedAt?: string | null }>(items: readonly T[], correction: TimelineCorrection, nowMs: number) {
  const from = ms(correction.spanStartedAt);
  const to = ms(correction.spanStoppedAt);
  let best: T | null = null;
  let bestMs = 0;
  for (const item of items) {
    const overlap = overlapMs(from, to, ms(item.startedAt), item.stoppedAt ? ms(item.stoppedAt) : nowMs);
    if (overlap > bestMs) {
      best = item;
      bestMs = overlap;
    }
  }
  return best && bestMs * 2 >= to - from ? best : null;
}

function placeMatchKindFor(target: TimelineCorrection["target"]): StaySegment["placeMatchKind"] {
  return target.placeId ? "saved" : target.learnedPlaceId ? "learned" : "unknown";
}

/** Part of a leg, [fromMs, toMs] inside it, with its share of the leg's distance. */
function legPart(leg: TripLeg, fromMs: number, toMs: number): TripLeg {
  const total = ms(leg.stoppedAt) - ms(leg.startedAt);
  return { ...leg, startedAt: new Date(fromMs).toISOString(), stoppedAt: new Date(toMs).toISOString(),
    distanceMeters: leg.distanceMeters == null || !(total > 0) ? leg.distanceMeters : Math.round(leg.distanceMeters * (toMs - fromMs) / total) };
}

/**
 * A trip's legs with the person's mode over the corrected span: every leg the span covers takes the mode
 * there, clamped to the leg, and keeps the engine's mode outside it (consecutive legs of one mode are one
 * leg, card A, so a later correction can cover parts of earlier ones; Codex r1–r3 on #590). Nothing changes
 * unless the legs together cover at least half of the span, as a correction's item always must.
 */
function legsWithMode(legs: readonly TripLeg[] | undefined, correction: TimelineCorrection): TripLeg[] | undefined {
  if (!legs?.length || !correction.target.mode) return legs ? [...legs] : undefined;
  const spanFrom = ms(correction.spanStartedAt);
  const spanTo = ms(correction.spanStoppedAt);
  // The legs together, not one of them, must cover half the span (Codex r3 on #590).
  const covered = legs.reduce((sum, leg) => sum + overlapMs(spanFrom, spanTo, ms(leg.startedAt), ms(leg.stoppedAt)), 0);
  if (covered * 2 < spanTo - spanFrom) return [...legs];
  return legs.flatMap((leg) => {
    const legFrom = ms(leg.startedAt);
    const legTo = ms(leg.stoppedAt);
    const from = Math.max(legFrom, spanFrom);
    const to = Math.min(legTo, spanTo);
    if (!(to > from)) return [leg];
    const { runnerUp: _runnerUp, ...rest } = legPart(leg, from, to);
    return [
      ...(from > legFrom ? [legPart(leg, legFrom, from)] : []),
      { ...rest, mode: correction.target.mode!, confidence: "sure" as const, setByYou: true as const },
      ...(to < legTo ? [legPart(leg, to, legTo)] : [])
    ];
  });
}

const sum = (a: number | null | undefined, b: number | null | undefined) => a == null || b == null ? null : a + b;

/**
 * One trip from the trip into a place the person wasn't at and the trip out of it ("I wasn't here"): the
 * earlier trip's identity and start, the later one's end, both trips' legs and stops. The time at the place
 * is a pause between their legs. Low confidence, as a trip read across a stop is.
 */
export function joinTripsAcrossPlace(before: CommuteSegment, after: CommuteSegment, span: { startedAt: string; stoppedAt: string }): CommuteSegment {
  const legs = [...(before.tripLegs ?? []), ...(after.tripLegs ?? [])];
  const stops = [...(before.stops ?? []), ...(after.stops ?? [])];
  const travelMode = before.travelMode && before.travelMode === after.travelMode ? before.travelMode : undefined;
  // The earlier trip's identity and start; what the two trips had between them is set again below.
  const rest: CommuteSegment = { ...before };
  // Its classification described the trip in alone (a round trip, say), so the one trip has none (Codex r2 on #603).
  for (const key of ["legs", "outingStayIds", "travelMode", "tripLegs", "stops", "motionSupported", "motionTimed", "qualificationReason"] as const) {
    delete rest[key];
  }
  return {
    ...rest,
    stoppedAt: after.stoppedAt,
    stopLowerBoundAt: after.stopLowerBoundAt ?? null,
    stopUpperBoundAt: after.stopUpperBoundAt ?? null,
    toStaySegmentId: after.toStaySegmentId,
    toPlaceId: after.toPlaceId ?? null,
    routeDistanceMeters: sum(before.routeDistanceMeters, after.routeDistanceMeters),
    straightLineDistanceMeters: null,
    routeSampleCount: before.routeSampleCount + after.routeSampleCount,
    gapDurationSeconds: Math.round((ms(after.stoppedAt) - ms(before.startedAt)) / 1_000),
    maximumObservationGapSeconds: Math.max(before.maximumObservationGapSeconds, after.maximumObservationGapSeconds),
    continuityStatus: before.continuityStatus === "continuous" && after.continuityStatus === "continuous" ? "continuous" : "uncertain_gap",
    confidence: "low",
    ...(stops.length ? { stops } : {}),
    ...(travelMode ? { travelMode } : {}),
    ...(legs.length ? { tripLegs: mergeSameModeLegs(legs) } : {}),
    ...(before.motionSupported || after.motionSupported ? { motionSupported: true as const } : {}),
    ...(before.motionTimed || after.motionTimed ? { motionTimed: true as const } : {}),
    evidenceIds: [...new Set([...before.evidenceIds, ...after.evidenceIds])],
    setByYou: true,
    // Later corrections of the joined trip are tied to the earlier trip's span, as the engine derives it, so
    // replay finds them again (Codex r1 on #603).
    correctionSpan: before.correctionSpan ?? span
  };
}

/** Whether two visits are to one place the person has (saved or learned): "I didn't leave" joins only those. */
export function sameKnownPlace(a: Pick<StaySegment, "placeId" | "learnedPlaceId">, b: Pick<StaySegment, "placeId" | "learnedPlaceId">) {
  return Boolean((a.placeId && a.placeId === b.placeId) || (!a.placeId && !b.placeId && a.learnedPlaceId && a.learnedPlaceId === b.learnedPlaceId));
}

/** Two visits to one place, with the trip between them that the person didn't take: one stay ("I didn't leave"). */
export function joinVisits(first: StaySegment, second: StaySegment, span: { startedAt: string; stoppedAt: string }): StaySegment {
  return {
    ...first,
    // Still open, closed or finalised as its last part is (Codex r1 on #603).
    status: second.status,
    stoppedAt: second.stoppedAt ?? null,
    stopLowerBoundAt: second.stopLowerBoundAt ?? null,
    stopUpperBoundAt: second.stopUpperBoundAt ?? null,
    ...(second.locationOnlyStoppedAt ? { locationOnlyStoppedAt: second.locationOnlyStoppedAt } : {}),
    sampleCount: first.sampleCount + second.sampleCount,
    continuityStatus: first.continuityStatus === "continuous" && second.continuityStatus === "continuous" ? "continuous" : "uncertain_gap",
    evidenceIds: [...new Set([...first.evidenceIds, ...second.evidenceIds])],
    setByYou: true,
    correctionSpan: first.correctionSpan ?? span
  };
}

/**
 * The engine's segments with the person's corrections applied, oldest first, so a later correction of
 * the same item wins. Each correction finds its item among the engine's own segments, before any
 * correction changed their times, so a shortened item is still found by a later correction tied to its
 * original span (Codex r1 on #566). A corrected item carries `setByYou` and the span its corrections
 * are tied to (`correctionSpan`). A trip that wasn't one is left out, and so are a place the person wasn't
 * at (its trips either side made one) and a trip they didn't take (its two visits made one stay). Pure and deterministic: replay
 * calls it before it persists anything.
 */
export function applyTimelineCorrections(segments: readonly LocationSegment[], corrections: readonly TimelineCorrection[], nowMs: number) {
  return applyTimelineCorrectionsWithJoins(segments, corrections, nowMs).segments;
}

/**
 * As `applyTimelineCorrections`, with the stays "I didn't leave" folded into another (their id → the one they
 * joined), so replay can point what still names them, as the journey in progress does, at the stay that
 * stands for them (Codex r1 on #603).
 */
export function applyTimelineCorrectionsWithJoins(segments: readonly LocationSegment[], corrections: readonly TimelineCorrection[], nowMs: number) {
  const engineStays = segments.filter((segment): segment is StaySegment => segment.kind === "stay");
  const engineTrips = segments.filter((segment): segment is CommuteSegment => segment.kind === "commute");
  const stays = new Map<StaySegment, StaySegment | null>(engineStays.map((stay) => [stay, { ...stay }]));
  const trips = new Map<CommuteSegment, CommuteSegment | null>(engineTrips.map((trip) => [trip, { ...trip }]));
  // The engine item now standing for a place or trip, by its id as corrected so far.
  // An item a join folded into another stands for it from then on: a later correction of it (a leg's mode on
  // the trip out, the second visit's place) changes the one it joined (Codex r1 on #603).
  const tripJoinedInto = new Map<CommuteSegment, CommuteSegment>();
  const stayJoinedInto = new Map<StaySegment, StaySegment>();
  const joinedStayIds = new Map<string, string>();
  const survivor = <T>(joined: Map<T, T>, item: T) => {
    let current = item;
    for (let hops = 0; joined.has(current) && hops < joined.size; hops += 1) current = joined.get(current)!;
    return current;
  };
  // The item a correction is about: the engine's, by its span; failing that the item as corrected so far (a
  // leg of a joined trip spans both trips' time, which neither of the engine's covers half of; Codex r2 on #603).
  const findStay = (correction: TimelineCorrection) => {
    const found = bestOverlap(engineStays, correction, nowMs);
    if (found) return survivor(stayJoinedInto, found);
    const current = bestOverlap([...stays.values()].filter((stay): stay is StaySegment => stay != null), correction, nowMs);
    return current ? [...stays].find(([, stay]) => stay === current)![0] : null;
  };
  const findTrip = (correction: TimelineCorrection) => {
    const found = bestOverlap(engineTrips, correction, nowMs);
    if (found) return survivor(tripJoinedInto, found);
    const current = bestOverlap([...trips.values()].filter((trip): trip is CommuteSegment => trip != null), correction, nowMs);
    return current ? [...trips].find(([, trip]) => trip === current)![0] : null;
  };
  const engineSpan = (segment: LocationSegment) => ({ startedAt: segment.startedAt, stoppedAt: segment.stoppedAt ?? new Date(nowMs).toISOString() });
  const stayById = (id: string) => [...stays].find(([, stay]) => stay?.clientSegmentId === id) as [StaySegment, StaySegment] | undefined;
  const tripWhere = (test: (trip: CommuteSegment) => boolean) =>
    [...trips].find(([, trip]) => trip != null && test(trip)) as [CommuteSegment, CommuteSegment] | undefined;
  const ordered = [...corrections].sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id.localeCompare(b.id));
  const spanOf = (correction: TimelineCorrection) => ({ startedAt: correction.spanStartedAt, stoppedAt: correction.spanStoppedAt });
  for (const correction of ordered) {
    if (correction.subject === "place") {
      const engine = findStay(correction);
      const stay = engine ? stays.get(engine)! : null;
      if (!engine || !stay) continue;
      if (correction.kind === "place") {
        stays.set(engine, {
          ...stay,
          placeId: correction.target.placeId ?? null,
          learnedPlaceId: correction.target.learnedPlaceId ?? null,
          placeMatchKind: placeMatchKindFor(correction.target),
          setByYou: true,
          placeSetByYou: true,
          correctionSpan: spanOf(correction)
        });
      } else if (correction.kind === "times" && correction.target.startedAt && correction.target.stoppedAt) {
        stays.set(engine, { ...stay, startedAt: correction.target.startedAt, stoppedAt: correction.target.stoppedAt, setByYou: true,
          correctionSpan: spanOf(correction) });
      } else if (correction.kind === "delete") {
        // "I wasn't here": between two trips, which become one. Once the one trip is a block, replay leaves both
        // trips to it (decided history), and the place still leaves the day while no trip here ends or starts at
        // it (Codex r2 on #603).
        const before = tripWhere((trip) => trip.toStaySegmentId === stay.clientSegmentId);
        const after = tripWhere((trip) => trip.fromStaySegmentId === stay.clientSegmentId);
        if (!before && !after) {
          stays.set(engine, null);
          continue;
        }
        if (!before || !after || before[0] === after[0]) continue;
        trips.set(before[0], joinTripsAcrossPlace(before[1], after[1], engineSpan(before[0])));
        trips.set(after[0], null);
        tripJoinedInto.set(after[0], before[0]);
        stays.set(engine, null);
      }
    } else if (correction.subject === "trip") {
      const engine = findTrip(correction);
      const trip = engine ? trips.get(engine) : null;
      if (!engine || !trip) continue;
      if (correction.kind === "delete") trips.set(engine, null);
      else if (correction.kind === "merge") {
        // "I didn't leave": the visits either side become one stay. That they were one place was checked when the
        // person said so; a later change of either visit's place never undoes it (Codex r1 on #603).
        const first = stayById(trip.fromStaySegmentId);
        const second = stayById(trip.toStaySegmentId);
        if (!first || !second || first[0] === second[0]) continue;
        stays.set(first[0], joinVisits(first[1], second[1], engineSpan(first[0])));
        stays.set(second[0], null);
        stayJoinedInto.set(second[0], first[0]);
        joinedStayIds.set(second[1].clientSegmentId, first[1].clientSegmentId);
        trips.set(engine, null);
        // A trip that left the later visit now leaves the one stay.
        for (const [key, next] of trips) {
          if (next?.fromStaySegmentId === second[1].clientSegmentId) trips.set(key, { ...next, fromStaySegmentId: first[1].clientSegmentId });
        }
      }
      else if (correction.kind === "times" && correction.target.startedAt && correction.target.stoppedAt) {
        trips.set(engine, { ...trip, startedAt: correction.target.startedAt, stoppedAt: correction.target.stoppedAt, setByYou: true,
          correctionSpan: spanOf(correction) });
      }
    } else if (correction.subject === "leg" && correction.kind === "leg_mode") {
      const engine = findTrip(correction);
      const trip = engine ? trips.get(engine) : null;
      if (!engine || !trip?.tripLegs?.length) continue;
      trips.set(engine, { ...trip, tripLegs: legsWithMode(trip.tripLegs, correction) });
    }
  }
  // A corrected mode can match the leg beside it: they are one leg too.
  for (const [engine, trip] of trips) {
    if (trip?.tripLegs && trip.tripLegs !== engine.tripLegs) trips.set(engine, { ...trip, tripLegs: mergeSameModeLegs(trip.tripLegs) });
  }
  const out: LocationSegment[] = [
    ...[...stays.values()].filter((stay): stay is StaySegment => stay != null),
    ...[...trips.values()].filter((trip): trip is CommuteSegment => trip != null)
  ];
  // A stay folded into one that was itself folded later names the last.
  for (const [from, to] of joinedStayIds) {
    let target = to;
    for (let hops = 0; joinedStayIds.has(target) && hops < joinedStayIds.size; hops += 1) target = joinedStayIds.get(target)!;
    joinedStayIds.set(from, target);
  }
  return { segments: out.sort((a, b) => ms(a.startedAt) - ms(b.startedAt) || a.kind.localeCompare(b.kind)), joinedStayIds };
}
