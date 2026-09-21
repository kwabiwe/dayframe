import { describe, expect, it, vi } from "vitest";
import { deriveCommutes } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import type { ClassifiedEvidence, StaySegment } from "../src/location/types";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 7, 8, minute)).toISOString();
function stay(index: number): StaySegment {
  return { kind: "stay", clientSegmentId: `stay-${index}`, algorithmVersion: config.algorithmVersion,
    status: "finalised", startedAt: at(index * 30), stoppedAt: at(index * 30 + 10),
    placeId: `place-${index}`, placeMatchKind: "saved", candidatePlaceIds: [],
    centreLatitude: 51.5 + index * 0.02, centreLongitude: -0.12,
    sampleCount: 3, continuityStatus: "continuous", confidence: "high", evidenceIds: [] };
}
function point(id: string, minute: number, latitude: number, savedPlaceId?: string): ClassifiedEvidence {
  return { evidence: { clientEvidenceId: id, deviceId: "test", algorithmVersion: config.algorithmVersion,
    kind: "standard_location", occurredAt: at(minute), receivedAt: at(100), timeZone: "UTC",
    latitude, longitude: -0.12, horizontalAccuracyMeters: 5, speedMetersPerSecond: 8, savedPlaceId },
    impliedSpeedMetersPerSecond: null, match: null };
}
describe("commute invocation-local timestamp reuse", () => {
  it("preserves strict endpoints, latest origin support, route order and independent intervals", () => {
    const evidence = [point("start-boundary", 10, 51.5), point("origin-support", 12, 51.5, "place-0"),
      point("a", 15, 51.505), point("b", 25, 51.515), point("end-boundary", 30, 51.52),
      point("c", 45, 51.525), point("d", 55, 51.535)];
    const before = structuredClone(evidence);
    const result = deriveCommutes([stay(0), stay(1), stay(2)], evidence, config, at(100));
    expect(result).toHaveLength(2);
    expect(result.map(row => row.evidenceIds)).toEqual([["a", "b"], ["c", "d"]]);
    expect(result[0].startedAt).toBe(at(12));
    expect(result[0].stoppedAt).toBe(at(30));
    expect(evidence).toEqual(before);
    // No cross-invocation cache: changing a timestamp changes the next result.
    evidence[2].evidence.occurredAt = at(35);
    expect(deriveCommutes([stay(0), stay(1), stay(2)], evidence, config, at(100))[0].evidenceIds).not.toContain("a");
  });

  it("parses unrelated observation timestamps once, not for every stay pair", () => {
    const evidence = Array.from({ length: 200 }, (_, i) => point(`outside-${i}`, -1_000 - i, 51.5));
    const parse = vi.spyOn(Date, "parse");
    try {
      expect(deriveCommutes(Array.from({ length: 20 }, (_, i) => stay(i)), evidence, config, at(1_000))).toHaveLength(0);
      for (const item of evidence) expect(parse.mock.calls.filter(([value]) => value === item.evidence.occurredAt)).toHaveLength(1);
    } finally { parse.mockRestore(); }
  });
});
