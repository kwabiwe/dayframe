import type { LocationEvidence, SavedPlaceForMatching } from "@dayframe/shared";
import { isIsoInstant } from "./answerKey";
import { HarnessError } from "./errors";

/**
 * Pipe-separated evidence and place rows in relative metres. A private export (see README) keeps
 * positions as metres east (x) and north (y) of an arbitrary origin, so the files hold no coordinates;
 * replay projects them back around a synthetic origin latitude. Distances survive the projection, so
 * the engine sees the same geometry wherever the origin is put.
 *
 * Places:   label|x|y|radiusMeters|role|loggingEnabled(t/f)|autoLog(t/f)|priority
 * Evidence: n|kind|occurredAt|endedAt|receivedAt|x|y|accuracy|speed|course|placeLabel|simulated|
 *           motionActivity|motionConfidence|motionContinuation|visitDepartureOpen|nativeCallbackAt|
 *           authorizationStatus|accuracyAuthorization|accepted|timeZone|geofenceIdentifier|altitude
 */

export const METRES_PER_DEGREE_LATITUDE = 110540;
export const METRES_PER_DEGREE_LONGITUDE_AT_EQUATOR = 111320;

export type Projection = { toLatitude: (y: number) => number; toLongitude: (x: number) => number };

export function projectionAround(originLatitude: number): Projection {
  const cos = Math.cos((originLatitude * Math.PI) / 180);
  return {
    toLatitude: (y) => originLatitude + y / METRES_PER_DEGREE_LATITUDE,
    toLongitude: (x) => x / (METRES_PER_DEGREE_LONGITUDE_AT_EQUATOR * cos)
  };
}

/** "P4" ↔ a stable synthetic UUID, so place labels survive the engine. */
export const placeIdFromLabel = (label: string) => `10000000-0000-4000-8000-${label.slice(1).padStart(12, "0")}`;
export const placeLabelFromId = (id: string | null | undefined) => (id ? `P${Number(id.slice(-12))}` : "-");

const lines = (text: string) => text.trim().split("\n").filter(Boolean);
const numberOrNull = (value: string) => (value === "" ? null : Number(value));

export type PlaceRow = SavedPlaceForMatching & { label: string };

export function parsePlaceRows(text: string, projection: Projection): PlaceRow[] {
  return lines(text).map((line) => {
    const [label, x, y, radius, role, logging, , priority] = line.split("|");
    return {
      label,
      id: placeIdFromLabel(label),
      name: label,
      role: role === "home" || role === "work" ? role : null,
      latitude: projection.toLatitude(Number(y)),
      longitude: projection.toLongitude(Number(x)),
      radiusMeters: Number(radius),
      priority: Number(priority),
      loggingEnabled: logging === "t"
    };
  });
}

export type EvidenceRowOptions = {
  algorithmVersion: string;
  /** Leave out Motion & Fitness rows, to see what the engine does on location alone. */
  dropMotion?: boolean;
  /** Only rows the server had received by this instant (epoch ms). */
  receivedUntil?: number;
};

export function parseEvidenceRows(text: string, projection: Projection, options: EvidenceRowOptions): LocationEvidence[] {
  const out: LocationEvidence[] = [];
  for (const [index, line] of lines(text).entries()) {
    const [n, kind, occurredAt, endedAt, receivedAt, x, y, accuracy, speed, course, place, simulated, activity, confidence,
      continuation, open, callbackAt, authorization, accuracyAuthorization, accepted, timeZone, geofence, altitude] = line.split("|");
    if (accepted !== "true") continue;
    // Errors name the line, never a value from the row.
    if (!/^\d+$/.test(n)) throw new HarnessError(`Evidence line ${index + 1} has an invalid row number.`);
    // Times go into the engine's segments verbatim: only strict ISO instants, never free text.
    for (const time of [occurredAt, receivedAt, ...(endedAt ? [endedAt] : []), ...(callbackAt ? [callbackAt] : [])]) {
      if (!isIsoInstant(time)) throw new HarnessError(`Evidence line ${index + 1} has an invalid timestamp.`);
    }
    if (options.dropMotion && kind === "motion_activity") continue;
    if (options.receivedUntil !== undefined && Date.parse(receivedAt) > options.receivedUntil) continue;
    const metadata: Record<string, unknown> = {};
    if (kind === "motion_activity") {
      metadata.motionActivity = activity;
      metadata.motionConfidence = confidence;
      if (continuation === "true") metadata.motionContinuation = true;
    }
    if (open === "true") metadata.visitDepartureOpen = true;
    if (callbackAt) metadata.nativeCallbackAt = callbackAt;
    if (authorization) metadata.authorizationStatus = authorization;
    if (accuracyAuthorization) metadata.accuracyAuthorization = accuracyAuthorization;
    out.push({
      clientEvidenceId: `e${n.padStart(5, "0")}`,
      deviceId: "dev",
      algorithmVersion: options.algorithmVersion,
      kind: kind as LocationEvidence["kind"],
      occurredAt,
      endedAt: endedAt || null,
      receivedAt,
      latitude: x === "" ? null : projection.toLatitude(Number(y)),
      longitude: x === "" ? null : projection.toLongitude(Number(x)),
      horizontalAccuracyMeters: numberOrNull(accuracy),
      speedMetersPerSecond: numberOrNull(speed),
      courseDegrees: numberOrNull(course),
      altitudeMeters: numberOrNull(altitude ?? ""),
      savedPlaceId: place ? placeIdFromLabel(place) : null,
      geofenceIdentifier: geofence ? `gf-${geofence}` : null,
      isSimulated: simulated === "" ? null : simulated === "true",
      timeZone: timeZone || "Europe/London",
      metadata: metadata as LocationEvidence["metadata"]
    });
  }
  return out;
}
