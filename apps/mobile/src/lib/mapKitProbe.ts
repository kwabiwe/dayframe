import * as Location from "expo-location";
import { probeMapKit, type MapKitProbeLookupRound, type MapKitProbeReport } from "../../modules/dayframe-place-search";

/**
 * Settings › Sync help › "Check Apple Maps nearby data": the MapKit checks for location v3
 * PR 7/8 (`.codex-dayframe-qa/location-v3/mapkit-checks.md`). The native probe asks Apple's map
 * service a fixed set of questions where the person stands and returns counts, distances, kinds
 * and yes/no answers only. The point it asks about is never shared, stored or shown.
 */
export type MapKitCheckOutcome =
  | { status: "ready"; message: string }
  | { status: "needs_location" }
  | { status: "no_position" }
  | { status: "unavailable" };

type Dependencies = {
  permission: () => Promise<{ granted: boolean }>;
  position: () => Promise<{ latitude: number; longitude: number } | null>;
  probe: (latitude: number, longitude: number) => Promise<MapKitProbeReport>;
  now: () => Date;
};

const POSITION_TIMEOUT_MS = 15_000;

const defaults: Dependencies = {
  permission: () => Location.getForegroundPermissionsAsync(),
  position: async () => {
    const reading = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), POSITION_TIMEOUT_MS))
    ]).catch(() => null);
    return reading ? { latitude: reading.coords.latitude, longitude: reading.coords.longitude } : null;
  },
  probe: probeMapKit,
  now: () => new Date()
};

export async function runMapKitChecks(dependencies: Partial<Dependencies> = {}): Promise<MapKitCheckOutcome> {
  const { permission, position, probe, now } = { ...defaults, ...dependencies };
  if (!(await permission().catch(() => ({ granted: false }))).granted) return { status: "needs_location" };
  const point = await position();
  if (!point) return { status: "no_position" };
  let report: MapKitProbeReport;
  try {
    report = await probe(point.latitude, point.longitude);
  } catch {
    return { status: "unavailable" };
  }
  return {
    status: "ready",
    // Rebuilt field by field, so nothing the native side might add (a name, an ID, the point) is shared.
    message: JSON.stringify({ check: "dayframe-mapkit-checks", ranAt: now().toISOString(), ...sharedReport(report) }, null, 2)
  };
}

/** One run per app process: a second tap, or Settings opened again meanwhile, joins the run already going. */
let current: { id: number; result: Promise<MapKitCheckOutcome> } | null = null;
let nextRunId = 1;

export function startMapKitChecks(dependencies: Partial<Dependencies> = {}) {
  if (current) return current;
  const run = { id: nextRunId++, result: runMapKitChecks(dependencies) };
  current = run;
  void run.result.finally(() => {
    if (current === run) current = null;
  });
  return run;
}

export function runningMapKitChecks() {
  return current;
}

const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const nullableNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const word = (value: unknown) => (typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : null);
const bool = (value: unknown) => value === true;

function lookupRound(value: MapKitProbeLookupRound | null | undefined): MapKitProbeLookupRound | null {
  if (!value || typeof value !== "object") return null;
  return { found: number(value.found), notFound: number(value.notFound), failed: number(value.failed), failure: word(value.failure) };
}

function sharedReport(report: MapKitProbeReport): MapKitProbeReport {
  const kinds: Record<string, number> = {};
  for (const [key, count] of Object.entries(report.kindsWithin400m ?? {})) {
    // Apple's category keys ("FitnessCenter"), never free text.
    if (/^[A-Za-z]{1,40}$/.test(key)) kinds[key] = number(count);
  }
  return {
    osVersion: typeof report.osVersion === "string" && /^[\d.]{1,16}$/.test(report.osVersion) ? report.osVersion : "unknown",
    radii: (report.radii ?? []).map((radius) => ({
      radiusMeters: number(radius.radiusMeters),
      count: number(radius.count),
      farthestMeters: nullableNumber(radius.farthestMeters),
      error: word(radius.error)
    })),
    kindsWithin400m: kinds,
    areasOfInterest: {
      answered: bool(report.areasOfInterest?.answered),
      count: number(report.areasOfInterest?.count),
      error: word(report.areasOfInterest?.error)
    },
    placeIds: {
      supported: bool(report.placeIds?.supported),
      places: number(report.placeIds?.places),
      withPlaceId: number(report.placeIds?.withPlaceId),
      lookup: lookupRound(report.placeIds?.lookup),
      lookupAMinuteLater: lookupRound(report.placeIds?.lookupAMinuteLater)
    },
    rapid: {
      attempts: number(report.rapid?.attempts),
      succeeded: number(report.rapid?.succeeded),
      firstErrorAt: nullableNumber(report.rapid?.firstErrorAt),
      firstError: word(report.rapid?.firstError)
    }
  };
}
