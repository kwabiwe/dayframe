import { LOCATION_ENGINE_V2_CONFIG, type LocationEvidence } from "@dayframe/shared";
export const RELIABILITY_CLOCK = "2026-09-14T00:00:00.000Z";
export const RELIABILITY_CUTOVER = "2026-09-07T00:00:00.000Z";
export const RELIABILITY_DEVICE = "reliability-synthetic-device";
export function reliabilityHistory(): LocationEvidence[] {
  const rows: LocationEvidence[] = [];
  for (let day = 0; day < 7; day++) {
    for (let trip = 0; trip < 4; trip++) {
      const start = Date.parse(RELIABILITY_CUTOVER) + day * 86_400_000 + (6 + trip * 3) * 3_600_000;
      for (let i = 0; i < 30; i++) {
        const minute = i < 10 ? i * 2 : i < 20 ? 20 + (i - 10) : 32 + (i - 20) * 2;
        const fraction = i < 10 ? 0 : i < 20 ? (i - 9) / 11 : 1;
        rows.push({ clientEvidenceId: `day-${day}-trip-${trip}-point-${i}`, deviceId: RELIABILITY_DEVICE,
          algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion, kind: "standard_location",
          occurredAt: new Date(start + minute * 60_000).toISOString(), receivedAt: RELIABILITY_CLOCK,
          timeZone: "Europe/London", latitude: 51.5 + fraction * 0.025, longitude: -0.12,
          horizontalAccuracyMeters: 10, altitudeMeters: 0, speedMetersPerSecond: i >= 10 && i < 20 ? 4 : 0,
          courseDegrees: 0, metadata: {} });
      }
    }
  }
  for (let i = 0; i < 20; i++) rows.push({clientEvidenceId:`provider-${i}`,deviceId:RELIABILITY_DEVICE,
    algorithmVersion:LOCATION_ENGINE_V2_CONFIG.algorithmVersion, kind:"provider_status", occurredAt:RELIABILITY_CLOCK,
    receivedAt:RELIABILITY_CLOCK,timeZone:"Europe/London",metadata:{}});
  return rows;
}
