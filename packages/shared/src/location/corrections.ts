import { z } from "zod";
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

/** A trip's leg with the person's mode: the leg overlapping the corrected span most. */
function legsWithMode(legs: readonly TripLeg[] | undefined, correction: TimelineCorrection): TripLeg[] | undefined {
  if (!legs?.length || !correction.target.mode) return legs ? [...legs] : undefined;
  const leg = bestOverlap(legs, correction, Number.POSITIVE_INFINITY);
  if (!leg) return [...legs];
  return legs.map((other) => other === leg ? {
    startedAt: other.startedAt,
    stoppedAt: other.stoppedAt,
    mode: correction.target.mode!,
    confidence: "sure",
    distanceMeters: other.distanceMeters,
    setByYou: true
  } : other);
}

/**
 * The engine's segments with the person's corrections applied, oldest first, so a later correction of
 * the same item wins. A corrected item carries `setByYou`. A trip that wasn't one is left out. Pure and
 * deterministic: replay calls it before it persists anything.
 */
export function applyTimelineCorrections(segments: readonly LocationSegment[], corrections: readonly TimelineCorrection[], nowMs: number) {
  let stays = segments.filter((segment): segment is StaySegment => segment.kind === "stay").map((stay) => ({ ...stay }));
  let commutes = segments.filter((segment): segment is CommuteSegment => segment.kind === "commute").map((commute) => ({ ...commute }));
  const ordered = [...corrections].sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || a.id.localeCompare(b.id));
  for (const correction of ordered) {
    if (correction.subject === "place") {
      const stay = bestOverlap(stays, correction, nowMs);
      if (!stay) continue;
      if (correction.kind === "place") {
        stays = stays.map((other) => other === stay ? {
          ...other,
          placeId: correction.target.placeId ?? null,
          learnedPlaceId: correction.target.learnedPlaceId ?? null,
          placeMatchKind: placeMatchKindFor(correction.target),
          setByYou: true as const
        } : other);
      } else if (correction.kind === "times" && correction.target.startedAt && correction.target.stoppedAt) {
        stays = stays.map((other) => other === stay ? {
          ...other, startedAt: correction.target.startedAt!, stoppedAt: correction.target.stoppedAt!, setByYou: true as const
        } : other);
      }
    } else if (correction.subject === "trip") {
      const trip = bestOverlap(commutes, correction, nowMs);
      if (!trip) continue;
      if (correction.kind === "delete") commutes = commutes.filter((other) => other !== trip);
      else if (correction.kind === "times" && correction.target.startedAt && correction.target.stoppedAt) {
        commutes = commutes.map((other) => other === trip ? {
          ...other, startedAt: correction.target.startedAt!, stoppedAt: correction.target.stoppedAt!, setByYou: true as const
        } : other);
      }
    } else if (correction.subject === "leg" && correction.kind === "leg_mode") {
      const trip = bestOverlap(commutes, correction, nowMs);
      if (!trip?.tripLegs?.length) continue;
      commutes = commutes.map((other) => other === trip ? { ...other, tripLegs: legsWithMode(other.tripLegs, correction) } : other);
    }
  }
  return [...stays, ...commutes].sort((a, b) => ms(a.startedAt) - ms(b.startedAt) || a.kind.localeCompare(b.kind));
}
