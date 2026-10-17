import * as Location from "expo-location";
import { probeMapKit, type MapKitProbeReport } from "../../modules/dayframe-place-search";

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
    // Only the report's own fields: the point stays here.
    message: JSON.stringify({ check: "dayframe-mapkit-checks", ranAt: now().toISOString(), ...pickReport(report) }, null, 2)
  };
}

function pickReport(report: MapKitProbeReport): MapKitProbeReport {
  return {
    osVersion: report.osVersion,
    radii: report.radii,
    kindsWithin400m: report.kindsWithin400m,
    areasOfInterest: report.areasOfInterest,
    placeIds: report.placeIds,
    rapid: report.rapid
  };
}
