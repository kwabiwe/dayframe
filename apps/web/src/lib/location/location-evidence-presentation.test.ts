import { describe, expect, it } from "vitest";
import type { LocationReviewEvidenceDto } from "@dayframe/shared";
import {
  hasLocationMapGeometry,
  locationEvidenceCaption,
  locationEvidenceMapMode,
  locationEvidenceRetentionLabel
} from "./location-evidence-presentation";

describe("location evidence presentation", () => {
  it("calls an endpoint-only commute an estimate instead of a recorded route", () => {
    const evidence = fixture({
      map: {
        ...fixture().map,
        straightLineFallback: {
          type: "LineString",
          coordinates: [[0.1, 51.5], [0.2, 51.6]]
        }
      }
    });

    expect(locationEvidenceMapMode(evidence)).toBe("endpoint_estimate");
    expect(locationEvidenceCaption(evidence)).toContain("dashed line is an estimate");
    expect(hasLocationMapGeometry(evidence)).toBe(true);
  });

  it("distinguishes absent, retained-without-coordinates, and expired raw evidence", () => {
    const absent = fixture();
    expect(locationEvidenceMapMode(absent)).toBe("no_mapped_evidence");
    expect(locationEvidenceCaption(absent)).toBe("No coordinate samples or anchors are attached to this item.");
    expect(locationEvidenceRetentionLabel(absent)).toBe("No raw evidence is attached to this item.");

    const retained = fixture({ rawEvidenceAvailable: true });
    expect(locationEvidenceCaption(retained)).toContain("no coordinates to plot");
    expect(locationEvidenceRetentionLabel(retained)).toBe("Raw evidence is temporarily retained.");

    const expired = fixture({ evidenceExpired: true });
    expect(locationEvidenceCaption(expired)).toContain("expired");
    expect(locationEvidenceRetentionLabel(expired)).toContain("derived time window remains available");
  });

  it("uses observed route language only when route geometry exists", () => {
    const evidence = fixture({
      map: {
        ...fixture().map,
        route: {
          type: "LineString",
          coordinates: [[0.1, 51.5], [0.2, 51.6]]
        },
        acceptedSamples: [{
          id: "sample-1",
          point: { type: "Point", coordinates: [0.1, 51.5] },
          occurredAt: "2026-08-14T09:00:00.000Z",
          accuracyMeters: 8,
          kind: "coordinate",
          role: "route"
        }]
      }
    });

    expect(locationEvidenceMapMode(evidence)).toBe("observed_route");
    expect(locationEvidenceCaption(evidence)).toContain("support the recorded route");
  });
});

function fixture(overrides: Partial<LocationReviewEvidenceDto> = {}): LocationReviewEvidenceDto {
  return {
    reviewItemId: "10000000-0000-4000-8000-000000000001",
    eventId: "10000000-0000-4000-8000-000000000002",
    segment: {
      id: "segment-1",
      kind: "commute",
      status: "open",
      startedAt: "2026-08-14T09:00:00.000Z",
      stoppedAt: "2026-08-14T10:00:00.000Z",
      confidence: "medium",
      continuityStatus: "continuous",
      algorithmVersion: "location-v2.0",
      evidenceCount: 0,
      rejectedEvidenceCount: 0
    },
    display: {
      title: "Possible journey",
      subtitle: null,
      placeId: null,
      placeName: null,
      addressSummary: null
    },
    map: {
      centre: null,
      stayRadiusMeters: null,
      route: null,
      straightLineFallback: null,
      acceptedSamples: [],
      rejectedSamples: [],
      anchors: [],
      gaps: [],
      nearbySavedPlaces: []
    },
    suggestedSplitPoints: [],
    evidenceExpiresAt: null,
    evidenceExpired: false,
    rawEvidenceAvailable: false,
    textualSummary: "No location evidence.",
    ...overrides
  };
}
