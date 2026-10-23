import type { TripLeg } from "./types";

/**
 * GET /api/timeline?date= (location v4 step 8): the day's location timeline, read-only. Places (stays),
 * trips with their legs and stop ids, the journey in progress, and the gaps nothing covers. Never
 * coordinates; place names are the user's own.
 */
export type TimelinePlace = {
  kind: "place";
  id: string;
  status: string;
  startedAt: string;
  stoppedAt: string | null;
  placeId: string | null;
  learnedPlaceId: string | null;
  /** The saved or accepted learned place's name, or null for an unknown place. */
  name: string | null;
  role: string | null;
  matchKind: "saved" | "learned" | "unknown" | "ambiguous";
  confidence: string;
  /** The user's blocks made from this place (its event's segment), so the List can tell logged from not. */
  blockIds: string[];
  /** The person corrected this place's place or times (location v4 step 11): the List shows "You set this". */
  setByYou?: true;
};

export type TimelineTrip = {
  kind: "trip";
  id: string;
  status: string;
  startedAt: string;
  stoppedAt: string;
  fromId: string;
  toId: string;
  mode: string | null;
  legs: TripLeg[];
  /** Short stops inside the trip, each its own place item's id. */
  stopIds: string[];
  distanceMeters: number | null;
  confidence: string;
  reason: string | null;
  /** The blocks made from this trip, which show its legs. */
  blockIds: string[];
  /** The person corrected this trip's times (location v4 step 11). */
  setByYou?: true;
};

export type TimelineOpenTrip = {
  kind: "open_trip";
  fromId: string;
  startedAt: string;
  lastObservedAt: string;
  mode: string | null;
  legs: TripLeg[];
};

export type TimelineGap = { kind: "gap"; startedAt: string; stoppedAt: string };

export type LocationTimeline = {
  date: string;
  timeZone: string;
  dayStart: string;
  dayEnd: string;
  items: Array<TimelinePlace | TimelineTrip>;
  openTrip: TimelineOpenTrip | null;
  gaps: TimelineGap[];
};

