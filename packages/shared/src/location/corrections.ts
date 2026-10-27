import { z } from "zod";
import { mergeSameModeLegs } from "./legs";
import type { CommuteSegment, LocationSegment, StaySegment, TripLeg, TripLegMode } from "./types";

/**
 * Timeline corrections (location v4 §4, §14; build step 11): what the person set on their location
 * timeline, tied to the time it covers and applied again by every replay. A corrected item shows "You
 * set this" and replay never changes it. Part 1 handles a place's place and times, a trip's times, a
 * trip that wasn't one, and a leg's mode; the other kinds the table allows (split, merge, leg boundary,
 * leg split, leg merge) come with the correction sheets. Never coordinates.
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

/** One correction the app sends: the item it is about (its timeline id) and what the person set. */
export const TimelineCorrectionRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("place"),
    subject: z.literal("place"),
    itemId,
    placeId: z.string().uuid().nullable(),
    learnedPlaceId: z.string().uuid().nullable()
  }).refine((value) => !(value.placeId && value.learnedPlaceId), { message: "Choose a saved place or a learned place, not both." }),
  z.object({
    kind: z.literal("times"),
    subject: z.enum(["place", "trip"]),
    itemId,
    startedAt: instant,
    stoppedAt: instant
  }).refine((value) => Date.parse(value.stoppedAt) > Date.parse(value.startedAt), { message: "The end must be after the start." }),
  z.object({ kind: z.literal("delete"), subject: z.literal("trip"), itemId }),
  z.object({
    kind: z.literal("leg_mode"),
    subject: z.literal("leg"),
    itemId,
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

/**
 * The engine's segments with the person's corrections applied, oldest first, so a later correction of
 * the same item wins. Each correction finds its item among the engine's own segments, before any
 * correction changed their times, so a shortened item is still found by a later correction tied to its
 * original span (Codex r1 on #566). A corrected item carries `setByYou` and the span its corrections
 * are tied to (`correctionSpan`). A trip that wasn't one is left out. Pure and deterministic: replay
 * calls it before it persists anything.
 */
export function applyTimelineCorrections(segments: readonly LocationSegment[], corrections: readonly TimelineCorrection[], nowMs: number) {
  const engineStays = segments.filter((segment): segment is StaySegment => segment.kind === "stay");
  const engineTrips = segments.filter((segment): segment is CommuteSegment => segment.kind === "commute");
  const stays = new Map<StaySegment, StaySegment>(engineStays.map((stay) => [stay, { ...stay }]));
  const trips = new Map<CommuteSegment, CommuteSegment | null>(engineTrips.map((trip) => [trip, { ...trip }]));
  const ordered = [...corrections].sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id.localeCompare(b.id));
  const spanOf = (correction: TimelineCorrection) => ({ startedAt: correction.spanStartedAt, stoppedAt: correction.spanStoppedAt });
  for (const correction of ordered) {
    if (correction.subject === "place") {
      const engine = bestOverlap(engineStays, correction, nowMs);
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
      }
    } else if (correction.subject === "trip") {
      const engine = bestOverlap(engineTrips, correction, nowMs);
      const trip = engine ? trips.get(engine) : null;
      if (!engine || !trip) continue;
      if (correction.kind === "delete") trips.set(engine, null);
      else if (correction.kind === "times" && correction.target.startedAt && correction.target.stoppedAt) {
        trips.set(engine, { ...trip, startedAt: correction.target.startedAt, stoppedAt: correction.target.stoppedAt, setByYou: true,
          correctionSpan: spanOf(correction) });
      }
    } else if (correction.subject === "leg" && correction.kind === "leg_mode") {
      const engine = bestOverlap(engineTrips, correction, nowMs);
      const trip = engine ? trips.get(engine) : null;
      if (!engine || !trip?.tripLegs?.length) continue;
      trips.set(engine, { ...trip, tripLegs: legsWithMode(trip.tripLegs, correction) });
    }
  }
  // A corrected mode can match the leg beside it: they are one leg too.
  for (const [engine, trip] of trips) {
    if (trip?.tripLegs && trip.tripLegs !== engine.tripLegs) trips.set(engine, { ...trip, tripLegs: mergeSameModeLegs(trip.tripLegs) });
  }
  const out: LocationSegment[] = [...stays.values(), ...[...trips.values()].filter((trip): trip is CommuteSegment => trip != null)];
  return out.sort((a, b) => ms(a.startedAt) - ms(b.startedAt) || a.kind.localeCompare(b.kind));
}
