/**
 * The answer key: a Google Timeline (on-device "Timeline.json") export, read as times, modes and metres.
 * Google's top-level visits are places, the activities between two visits are one trip, and each
 * activity is a leg (consecutive legs of one mode merge). Visit coordinates and place IDs are never read
 * beyond telling Home from other places.
 */

export type FineMode = "walk" | "cycle" | "car" | "bus" | "rail" | "underground" | "flight" | "unknown";

/** Google activity types → the modes the design scores. Anything else is "unknown". */
export const GOOGLE_FINE_MODE: Record<string, FineMode> = {
  walking: "walk",
  "on foot": "walk",
  running: "walk",
  hiking: "walk",
  cycling: "cycle",
  "in passenger vehicle": "car",
  driving: "car",
  "in vehicle": "car",
  "in taxi": "car",
  motorcycling: "car",
  "in bus": "bus",
  "in train": "rail",
  "in tram": "rail",
  "in subway": "underground",
  flying: "flight"
};

/** Mode families: right family, wrong vehicle still counts as "coarse" right. */
export const COARSE_MODE: Partial<Record<string, string>> = {
  walk: "foot",
  cycle: "cycle",
  car: "vehicle",
  bus: "vehicle",
  rail: "vehicle",
  underground: "vehicle",
  flight: "vehicle"
};

/** A Google activity of 30+ minutes averaging under 0.3 m/s fills a gap; the answer key is unsure there. */
export const FILLER_MIN_SECONDS = 1800;
export const FILLER_MAX_METRES_PER_SECOND = 0.3;
/** Trips shorter than this are kept for "is this Move real" but not scored as trips to find. */
export const MIN_SCORED_TRIP_SECONDS = 120;

export type TimelineEntry = {
  startTime: string;
  endTime: string;
  visit?: { hierarchyLevel?: string | number; topCandidate?: { semanticType?: string } };
  activity?: { distanceMeters?: string | number | null; topCandidate?: { type?: string } };
  timelinePath?: unknown;
};

/** Times are epoch seconds throughout the harness. */
export type KeyStay = { a: number; b: number; home: boolean };
export type KeyActivity = { a: number; b: number; mode: FineMode; dist: number; filler: boolean };
export type KeyLeg = { a: number; b: number; mode: FineMode; dist: number };
export type KeyTrip = { a: number; b: number; legs: KeyLeg[] };

export type AnswerKey = {
  stays: KeyStay[];
  /** Activities the key is sure about (no gap fillers). */
  activities: KeyActivity[];
  /** Every activity, fillers included. */
  allActivities: KeyActivity[];
  fillers: KeyActivity[];
  /** Trips of two minutes or more with no filler leg. */
  trips: KeyTrip[];
  /** Every filler-free trip, however short. */
  allTrips: KeyTrip[];
};

export const toSeconds = (iso: string): number => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`Invalid timestamp in answer key: ${iso}`);
  return ms / 1000;
};

/** Reads the export, keeping only entries that overlap [from, to). */
export function readAnswerKey(entries: TimelineEntry[], from: number, to: number): AnswerKey {
  const stays: KeyStay[] = [];
  const allActivities: KeyActivity[] = [];
  for (const entry of entries) {
    const a = toSeconds(entry.startTime);
    const b = toSeconds(entry.endTime);
    if (b <= from || a >= to) continue;
    if (entry.visit && String(entry.visit.hierarchyLevel) === "0") {
      stays.push({ a, b, home: entry.visit.topCandidate?.semanticType === "Home" });
    } else if (entry.activity) {
      const dist = Number(entry.activity.distanceMeters ?? 0) || 0;
      const filler = b - a >= FILLER_MIN_SECONDS && dist / (b - a) < FILLER_MAX_METRES_PER_SECOND;
      const mode = GOOGLE_FINE_MODE[entry.activity.topCandidate?.type ?? ""] ?? "unknown";
      allActivities.push({ a, b, mode, dist, filler });
    }
  }
  stays.sort((x, y) => x.a - y.a);
  allActivities.sort((x, y) => x.a - y.a);

  // A trip is the run of activities between two visits; a run with a filler is left out.
  const trips: KeyTrip[] = [];
  const allTrips: KeyTrip[] = [];
  const timeline = [
    ...stays.map((stay) => ({ kind: "visit" as const, a: stay.a, activity: null })),
    ...allActivities.map((activity) => ({ kind: "activity" as const, a: activity.a, activity }))
  ].sort((x, y) => x.a - y.a);
  let run: KeyActivity[] = [];
  for (const item of [...timeline, { kind: "visit" as const, a: Infinity, activity: null }]) {
    if (item.activity) {
      run.push(item.activity);
      continue;
    }
    if (run.length > 0 && !run.some((activity) => activity.filler)) {
      const legs: KeyLeg[] = [];
      for (const activity of run) {
        const last = legs[legs.length - 1];
        if (last && last.mode === activity.mode) {
          last.b = activity.b;
          last.dist += activity.dist;
        } else {
          legs.push({ a: activity.a, b: activity.b, mode: activity.mode, dist: activity.dist });
        }
      }
      const trip = { a: run[0].a, b: run[run.length - 1].b, legs };
      allTrips.push(trip);
      if (trip.b - trip.a >= MIN_SCORED_TRIP_SECONDS) trips.push(trip);
    }
    run = [];
  }

  return {
    stays,
    activities: allActivities.filter((activity) => !activity.filler),
    allActivities,
    fillers: allActivities.filter((activity) => activity.filler),
    trips,
    allTrips
  };
}
