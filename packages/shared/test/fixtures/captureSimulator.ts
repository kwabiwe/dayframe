import { LOCATION_ENGINE_V2_CONFIG as config } from "../../src/location/config";
import type { LocationEngineInput, LocationEvidence } from "../../src/location/types";

/**
 * Synthetic iOS capture, shaped by retained staging traces rather than copied
 * from them. Positions are metres east/north of an arbitrary origin; no real
 * coordinates. Behaviour modelled:
 * - Expo standard locations obey the 75 m distance filter: a fix each time the
 *   device is that far from the previous fix, and silence while still apart
 *   from a settling fix and occasional drift fixes;
 * - native significant-change callbacks mirror some fixes at the same second
 *   without speed;
 * - each still period of four minutes or more yields an arrival-only Visit
 *   (usually dated within seconds of arrival, about one in ten up to 150 s
 *   early) and a broad, displaced completed callback ending shortly after
 *   departure;
 * - saved-place geofences report crossings a few seconds late;
 * - standard fixes reach the server in deferred batches, native callbacks later.
 */
export type Xy = { x: number; y: number };

type Travel = {
  to: Xy; via?: Xy[]; speed?: number;
  /** Reported accuracy range of the leg's fixes, metres (default accurate). */
  accuracy?: [number, number];
  /** False: a capture gap, no standard fixes along the leg (geofences still fire). */
  recorded?: boolean;
};

export type Leg =
  | {
    kind: "stay"; at?: Xy; minutes: number; indoor?: boolean; visit?: boolean; driftFixes?: boolean;
    /** False: no settling fix after arrival (the phone stays silent from the start). */
    settle?: boolean;
    /** One accurate still fix this far from the stay, this long after arrival (an isolated outlier). */
    stray?: { afterMinutes: number; metres: number };
  }
  | ({ kind: "drive" } & Travel)
  | ({ kind: "walk" } & Travel)
  /** Still on the road (traffic, a kerbside drop-off): no Visit, at most a settling fix. */
  | { kind: "hold"; seconds: number }
  /** The phone records nothing while staying where it is. */
  | { kind: "silence"; minutes: number };

export type SimPlace = { id: string; name: string; at: Xy; radius: number; loggingEnabled?: boolean };

export type Scenario = {
  /** ISO start instant. */
  start: string;
  /** Where the device is at the start. */
  origin: Xy;
  legs: Leg[];
  places: SimPlace[];
};

export type TruthStay = { from: number; to: number; at: Xy };
export type Simulation = {
  input: (processingAtMs?: number) => LocationEngineInput;
  truth: { stays: TruthStay[]; endMs: number };
  /** Milliseconds from the scenario start. */
  at: (minutes: number) => string;
};

const LAT0 = 51.7;
const toLatitude = (y: number) => LAT0 + y / 110_540;
const toLongitude = (x: number) => x / (111_320 * Math.cos((LAT0 * Math.PI) / 180));
const DEVICE = "20000000-0000-4000-8000-0000000000a1";
const DISTANCE_FILTER_METRES = 75;

function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function simulate(scenario: Scenario, seed: number): Simulation {
  const random = prng(seed);
  const between = (low: number, high: number) => low + (high - low) * random();
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
  // A fix's error is roughly its reported accuracy at one standard deviation per axis / 1.5.
  const jitter = (at: Xy, accuracy: number): Xy => ({ x: at.x + gaussian() * accuracy / 1.5, y: at.y + gaussian() * accuracy / 1.5 });
  const startMs = Date.parse(scenario.start);
  const evidence: LocationEvidence[] = [];
  const truthStays: TruthStay[] = [];
  let sequence = 0;
  let position = { ...scenario.origin };
  let now = startMs;
  let lastFix: Xy = { ...scenario.origin };
  let flushAt = startMs;

  const insidePlaces = (at: Xy) => new Set(scenario.places
    .filter((place) => Math.hypot(at.x - place.at.x, at.y - place.at.y) <= place.radius).map((place) => place.id));
  let inside = insidePlaces(position);

  const push = (item: Partial<LocationEvidence> & Pick<LocationEvidence, "kind" | "occurredAt" | "receivedAt">) => {
    sequence += 1;
    evidence.push({
      clientEvidenceId: `sim-${String(sequence).padStart(5, "0")}`, deviceId: DEVICE, algorithmVersion: config.algorithmVersion,
      sourceTimestamp: item.occurredAt, endedAt: null, latitude: null, longitude: null, horizontalAccuracyMeters: null,
      speedMetersPerSecond: null, savedPlaceId: null, timeZone: "Europe/London",
      isSimulated: item.kind === "standard_location" ? false : null, metadata: {}, ...item
    });
  };
  // Deferred Expo delivery: batches flush every few minutes while moving, or when the device next moves.
  const deferredReceipt = (atMs: number) => {
    if (atMs > flushAt) flushAt = atMs + between(30_000, 300_000);
    return new Date(Math.max(atMs + 500, flushAt)).toISOString();
  };
  const fix = (atMs: number, at: Xy, accuracy: number, speed: number | null, mirror = false, receivedAtMs?: number) => {
    const point = jitter(at, accuracy);
    const iso = new Date(Math.round(atMs)).toISOString();
    push({ kind: "standard_location", occurredAt: iso,
      receivedAt: receivedAtMs == null ? deferredReceipt(atMs) : new Date(receivedAtMs).toISOString(),
      latitude: toLatitude(point.y), longitude: toLongitude(point.x), horizontalAccuracyMeters: Math.round(accuracy * 10) / 10,
      speedMetersPerSecond: speed == null ? null : Math.max(0, Math.round(speed * 100) / 100) });
    if (mirror) {
      // The native mirror carries whole-second time and no speed; it is drained later.
      push({ kind: "significant_change", occurredAt: new Date(Math.floor(atMs / 1_000) * 1_000).toISOString(),
        receivedAt: new Date(atMs + between(5_000, 1_200_000)).toISOString(),
        latitude: toLatitude(point.y), longitude: toLongitude(point.x), horizontalAccuracyMeters: Math.round(accuracy * 10) / 10 });
    }
    lastFix = { ...at };
  };
  const geofences = (atMs: number, at: Xy) => {
    const next = insidePlaces(at);
    for (const place of scenario.places) {
      const was = inside.has(place.id);
      const is = next.has(place.id);
      if (was === is) continue;
      const occurred = atMs + between(1_000, 20_000);
      push({ kind: is ? "geofence_enter" : "geofence_exit", occurredAt: new Date(occurred).toISOString(),
        receivedAt: new Date(occurred + 200).toISOString(), savedPlaceId: place.id });
    }
    inside = next;
  };
  const travel = (to: Xy, via: Xy[] = [], speed: number, accuracy: () => number, recorded = true) => {
    let sinceMirror = 0;
    for (const waypoint of [...via, to]) {
      const length = Math.hypot(waypoint.x - position.x, waypoint.y - position.y);
      const steps = Math.max(1, Math.ceil(length / 5));
      const from = { ...position };
      for (let step = 1; step <= steps; step += 1) {
        const fraction = step / steps;
        const at = { x: from.x + (waypoint.x - from.x) * fraction, y: from.y + (waypoint.y - from.y) * fraction };
        const moved = length / steps;
        const stepSpeed = speed * between(0.85, 1.15);
        now += (moved / stepSpeed) * 1_000;
        sinceMirror += moved;
        position = at;
        geofences(now, at);
        // The distance filter compares displacement from the last fix, not path length.
        if (recorded && Math.hypot(at.x - lastFix.x, at.y - lastFix.y) >= DISTANCE_FILTER_METRES) {
          const mirror = sinceMirror >= 500 && random() < 0.6;
          fix(now, at, accuracy(), stepSpeed, mirror);
          if (mirror) sinceMirror = 0;
        }
      }
    }
  };

  for (const leg of scenario.legs) {
    if (leg.kind === "drive" || leg.kind === "walk") {
      const [low, high] = leg.accuracy ?? (leg.kind === "drive" ? [2, 5] : [4, 12]);
      travel(leg.to, leg.via, leg.speed ?? (leg.kind === "drive" ? 11 : 1.35), () => between(low, high), leg.recorded !== false);
    }
    else if (leg.kind === "silence") now += leg.minutes * 60_000;
    else if (leg.kind === "hold") {
      if (leg.seconds >= 45 && random() < 0.5) fix(now + between(5_000, Math.min(40_000, leg.seconds * 1_000)), position, between(3, 8), between(0, 0.3));
      now += leg.seconds * 1_000;
    } else {
      if (leg.at) {
        position = { ...leg.at };
        geofences(now, position);
      }
      const arrival = now;
      const departure = arrival + leg.minutes * 60_000;
      const accuracy = () => leg.indoor ? between(12, 60) : between(3, 9);
      truthStays.push({ from: arrival, to: departure, at: { ...position } });
      // Fixes taken while still are held in the deferred batch until the device moves on.
      const heldUntil = () => departure + between(5_000, 60_000);
      // A stay shorter than its settling delay gets no settling fix.
      const settledAt = arrival + between(5_000, 60_000);
      if (settledAt < departure && leg.settle !== false) fix(settledAt, position, accuracy(), between(0, 0.4), random() < 0.5, heldUntil());
      if (leg.stray && leg.stray.afterMinutes * 60_000 < leg.minutes * 60_000) {
        const angle = between(0, 2 * Math.PI);
        fix(arrival + leg.stray.afterMinutes * 60_000,
          { x: position.x + leg.stray.metres * Math.cos(angle), y: position.y + leg.stray.metres * Math.sin(angle) }, between(3, 6), 0, false, heldUntil());
        lastFix = { ...position };
      }
      if (leg.driftFixes !== false) {
        for (let t = arrival + between(4, 15) * 60_000; t < departure - 60_000; t += between(4, 15) * 60_000) {
          if (random() < 0.7) fix(t, position, accuracy(), between(0, 0.2), false, heldUntil());
        }
      }
      if (leg.visit !== false && leg.minutes >= 4) {
        // In a staging week 2 of 39 arrival callbacks were dated before the device
        // stopped (one by 157 s); the rest within seconds of arrival.
        const backdated = random() < 0.1 ? between(30_000, 150_000) : between(-10_000, 10_000);
        const visitArrival = Math.floor((arrival - backdated) / 1_000) * 1_000;
        const arrivalPoint = jitter(position, 6);
        push({ kind: "visit", occurredAt: new Date(visitArrival).toISOString(),
          receivedAt: new Date(arrival + between(120_000, 1_200_000)).toISOString(),
          latitude: toLatitude(arrivalPoint.y), longitude: toLongitude(arrivalPoint.x),
          horizontalAccuracyMeters: Math.round(between(4, 20)), metadata: { visitDepartureOpen: true } });
        const angle = between(0, 2 * Math.PI);
        const offset = between(10, 60);
        const completionEnd = Math.floor((departure + between(0, 120_000)) / 1_000) * 1_000;
        push({ kind: "visit", occurredAt: new Date(visitArrival).toISOString(), endedAt: new Date(completionEnd).toISOString(),
          receivedAt: new Date(completionEnd + between(60_000, 1_800_000)).toISOString(),
          latitude: toLatitude(position.y + offset * Math.sin(angle)), longitude: toLongitude(position.x + offset * Math.cos(angle)),
          horizontalAccuracyMeters: Math.round(between(30, 100)) });
      }
      now = departure;
      flushAt = now;
    }
  }
  const endMs = now;
  const savedPlaces = scenario.places.map((place) => ({
    id: place.id, name: place.name, latitude: toLatitude(place.at.y), longitude: toLongitude(place.at.x),
    radiusMeters: place.radius, loggingEnabled: place.loggingEnabled ?? true
  }));
  return {
    truth: { stays: truthStays, endMs },
    at: (minutes: number) => new Date(startMs + minutes * 60_000).toISOString(),
    input: (processingAtMs = endMs + 7_200_000) => ({
      priorState: { algorithmVersion: config.algorithmVersion, mode: "idle", activeSegmentId: null, processedEvidenceIds: [], lastProcessedAt: null },
      config, processingAt: new Date(processingAtMs).toISOString(), savedPlaces, acceptedLearnedPlaces: [],
      evidence: evidence.filter((item) => Date.parse(item.receivedAt) <= processingAtMs)
    })
  };
}
