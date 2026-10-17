import { describe, expect, it } from "vitest";
import { learnedLocationName, locationEvidenceDetails, locationEvidenceLine } from "./locationEvidenceSummary";

const point = { type: "Point" as const, coordinates: [0.1, 0.1] as [number, number] };
const sample = (id: string) => ({ id, point, occurredAt: "2026-10-17T10:00:00.000Z", accuracyMeters: 10, kind: "fix", role: null });
const gap = (minutes: number) => ({ startedAt: "2026-10-17T10:05:00.000Z", stoppedAt: "2026-10-17T10:30:00.000Z",
  durationSeconds: minutes * 60, fromPoint: null, toPoint: null });
const evidence = (readings: number, gaps: ReturnType<typeof gap>[], rejected = 0) => ({
  evidenceExpired: false, rawEvidenceAvailable: true, textualSummary: "Synthetic summary",
  // The segment's own counts (the map holds a thinned subset of 4 readings here).
  segment: { evidenceCount: readings, rejectedEvidenceCount: rejected },
  map: { acceptedSamples: Array.from({ length: readings }, (_, index) => sample(`s${index}`)),
    rejectedSamples: Array.from({ length: rejected }, (_, index) => ({ id: `r${index}`, point: null, occurredAt: "2026-10-17T10:00:00.000Z", kind: "fix", reason: "accuracy" })),
    gaps } 
}) as never;

describe("Location evidence line (owner, 17 Oct 2026)", () => {
  it("says what the suggestion rests on in one line", () => {
    expect(locationEvidenceLine(evidence(42, [gap(25), gap(13)]))).toBe("Based on 42 readings · 25-min gap");
    expect(locationEvidenceLine(evidence(1, []))).toBe("Based on 1 reading");
    expect(locationEvidenceLine(evidence(0, []))).toBeNull();
    expect(locationEvidenceLine({ ...(evidence(42, []) as object), evidenceExpired: true } as never)).toBe("Its readings are no longer kept");
    expect(locationEvidenceLine({ ...(evidence(42, []) as object), rawEvidenceAvailable: false } as never)).toBe("Its readings aren't available");
  });

  it("opens to each gap the server reports, readings left out and the summary", () => {
    expect(locationEvidenceDetails(evidence(42, [gap(25)], 2), (iso) => iso.slice(11, 16))).toEqual([
      "No readings 10:05–10:30 (25 min)", "2 readings were left out", "Synthetic summary"
    ]);
  });
});

describe("learnedLocationName", () => {
  it("offers only a name Dayframe learned", () => {
    expect(learnedLocationName({ title: " Swimming ", rawPayload: { nameSource: "learned" } })).toBe("Swimming");
    expect(learnedLocationName({ title: "Drive", rawPayload: {} })).toBeNull();
    expect(learnedLocationName(null)).toBeNull();
  });
});
