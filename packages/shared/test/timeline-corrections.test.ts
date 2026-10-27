import { describe, expect, it } from "vitest";
import { applyTimelineCorrections, TimelineCorrectionRequestSchema, type TimelineCorrection } from "../src/location/corrections";
import type { CommuteSegment, LocationSegment, StaySegment } from "../src/location/types";

// Location v4 step 11: synthetic times and identities only.
const at = (minutes: number) => new Date(Date.UTC(2026, 1, 16, 8) + minutes * 60_000).toISOString();
const SAVED = "00000000-0000-4000-8000-000000000001";
const LEARNED = "00000000-0000-4000-8000-000000000002";

function stay(id: string, from: number, to: number | null): StaySegment {
  return {
    kind: "stay", clientSegmentId: id, algorithmVersion: "test", status: "closed", startedAt: at(from), stoppedAt: to == null ? null : at(to),
    placeId: null, learnedPlaceId: null, placeMatchKind: "unknown", candidatePlaceIds: [], sampleCount: 3, continuityStatus: "continuous",
    confidence: "high", evidenceIds: []
  } as StaySegment;
}

function trip(id: string, from: number, to: number, legs?: CommuteSegment["tripLegs"]): CommuteSegment {
  return {
    kind: "commute", clientSegmentId: id, algorithmVersion: "test", status: "closed", startedAt: at(from), stoppedAt: at(to),
    fromStaySegmentId: "a", toStaySegmentId: "b", routeSampleCount: 4, gapDurationSeconds: 0, maximumObservationGapSeconds: 60,
    continuityStatus: "continuous", confidence: "high", evidenceIds: [], ...(legs ? { tripLegs: legs } : {})
  } as CommuteSegment;
}

function correction(partial: Partial<TimelineCorrection> & Pick<TimelineCorrection, "subject" | "kind">, from: number, to: number, created = 0): TimelineCorrection {
  return { id: `c-${created}-${partial.kind}`, target: {}, spanStartedAt: at(from), spanStoppedAt: at(to), createdAt: at(1_000 + created), ...partial };
}

const NOW = Date.parse(at(600));
const segments: LocationSegment[] = [
  stay("a", 0, 60),
  trip("t", 60, 90, [
    { startedAt: at(60), stoppedAt: at(70), mode: "walking", confidence: "sure", distanceMeters: 700 },
    { startedAt: at(70), stoppedAt: at(90), mode: "automotive", confidence: "unsure", runnerUp: "bus", distanceMeters: 9_000 }
  ]),
  stay("b", 90, null)
];

describe("timeline corrections (location v4 step 11)", () => {
  it("sets a place's place, marked as set by you", () => {
    const [first] = applyTimelineCorrections(segments, [correction({ subject: "place", kind: "place", target: { placeId: SAVED, learnedPlaceId: null } }, 0, 60)], NOW);
    expect(first).toMatchObject({ clientSegmentId: "a", placeId: SAVED, learnedPlaceId: null, placeMatchKind: "saved", setByYou: true });
  });

  it("finds the engine's item by the corrected span, so a correction still applies after replay moves its ends a little", () => {
    const moved = [stay("a2", 0, 62), ...segments.slice(1)];
    const [first] = applyTimelineCorrections(moved, [correction({ subject: "place", kind: "place", target: { placeId: null, learnedPlaceId: LEARNED } }, 0, 60)], NOW);
    expect(first).toMatchObject({ clientSegmentId: "a2", learnedPlaceId: LEARNED, placeMatchKind: "learned", setByYou: true });
  });

  it("leaves everything alone when no item covers at least half the span", () => {
    expect(applyTimelineCorrections(segments, [correction({ subject: "place", kind: "place", target: { placeId: SAVED } }, 700, 800)], NOW))
      .toEqual([...segments].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)));
  });

  it("sets a place's and a trip's times, and the newest correction of an item wins", () => {
    const result = applyTimelineCorrections(segments, [
      correction({ subject: "place", kind: "times", target: { startedAt: at(5), stoppedAt: at(55) } }, 0, 60, 1),
      correction({ subject: "place", kind: "times", target: { startedAt: at(10), stoppedAt: at(58) } }, 0, 60, 2),
      correction({ subject: "trip", kind: "times", target: { startedAt: at(58), stoppedAt: at(92) } }, 60, 90, 3)
    ], NOW);
    expect(result.find((segment) => segment.clientSegmentId === "a")).toMatchObject({ startedAt: at(10), stoppedAt: at(58), setByYou: true });
    expect(result.find((segment) => segment.clientSegmentId === "t")).toMatchObject({ startedAt: at(58), stoppedAt: at(92), setByYou: true });
  });

  it("leaves out a trip that wasn't one", () => {
    const result = applyTimelineCorrections(segments, [correction({ subject: "trip", kind: "delete" }, 60, 90)], NOW);
    expect(result.map((segment) => segment.clientSegmentId)).toEqual(["a", "b"]);
  });

  it("sets one leg's mode, sure and set by you, and keeps the others", () => {
    const result = applyTimelineCorrections(segments, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 70, 90)], NOW);
    const legs = (result.find((segment) => segment.clientSegmentId === "t") as CommuteSegment).tripLegs!;
    expect(legs[0]).toEqual(segments[1].kind === "commute" ? segments[1].tripLegs![0] : null);
    expect(legs[1]).toEqual({ startedAt: at(70), stoppedAt: at(90), mode: "bus", confidence: "sure", distanceMeters: 9_000, setByYou: true });
  });

  it("keeps a leg's other details when its mode is set (Codex r1 on #566)", () => {
    const unseen = [trip("u", 60, 90, [{ startedAt: at(60), stoppedAt: at(90), mode: "underground", confidence: "unsure", runnerUp: "train",
      unobserved: true, distanceMeters: 9_000 }])];
    const [corrected] = applyTimelineCorrections(unseen, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "train" } }, 60, 90)], NOW);
    expect((corrected as CommuteSegment).tripLegs).toEqual([{ startedAt: at(60), stoppedAt: at(90), mode: "train", confidence: "sure",
      unobserved: true, distanceMeters: 9_000, setByYou: true }]);
  });

  it("sets the mode only over its own span when consecutive legs of one mode are one leg (card A; Codex r1 on #590)", () => {
    // A correction saved on the first of two Underground legs, 60–70, after the engine merged them into 60–90.
    const merged = [trip("m", 60, 90, [{ startedAt: at(60), stoppedAt: at(90), mode: "underground", confidence: "sure", unobserved: true, distanceMeters: 9_000 }])];
    const [corrected] = applyTimelineCorrections(merged, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 60, 70)], NOW);
    expect((corrected as CommuteSegment).tripLegs).toEqual([
      { startedAt: at(60), stoppedAt: at(70), mode: "bus", confidence: "sure", unobserved: true, distanceMeters: 3_000, setByYou: true },
      { startedAt: at(70), stoppedAt: at(90), mode: "underground", confidence: "sure", unobserved: true, distanceMeters: 6_000 }
    ]);
    // Two corrections on its two parts both hold.
    const [both] = applyTimelineCorrections(merged, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "bus" } }, 60, 70, 1),
      correction({ subject: "leg", kind: "leg_mode", target: { mode: "train" } }, 70, 90, 2)], NOW);
    expect((both as CommuteSegment).tripLegs!.map(({ mode, startedAt, stoppedAt }) => [mode, startedAt, stoppedAt]))
      .toEqual([["bus", at(60), at(70)], ["train", at(70), at(90)]]);
  });

  it("makes a corrected leg one leg with a neighbour of the same mode, set by you", () => {
    const result = applyTimelineCorrections(segments, [correction({ subject: "leg", kind: "leg_mode", target: { mode: "automotive" } }, 60, 70)], NOW);
    expect((result.find((segment) => segment.clientSegmentId === "t") as CommuteSegment).tripLegs)
      .toEqual([{ startedAt: at(60), stoppedAt: at(90), mode: "automotive", confidence: "sure", distanceMeters: 9_700, setByYou: true }]);
  });

  it("finds each correction's item among the engine's own spans, so a shortened item is still found (Codex r1 on #566)", () => {
    const result = applyTimelineCorrections(segments, [
      correction({ subject: "place", kind: "times", target: { startedAt: at(0), stoppedAt: at(10) } }, 0, 60, 1),
      correction({ subject: "place", kind: "place", target: { placeId: SAVED, learnedPlaceId: null } }, 0, 60, 2),
      correction({ subject: "trip", kind: "times", target: { startedAt: at(85), stoppedAt: at(88) } }, 60, 90, 3),
      correction({ subject: "trip", kind: "delete" }, 60, 90, 4)
    ], NOW);
    expect(result.find((segment) => segment.clientSegmentId === "a")).toMatchObject({ startedAt: at(0), stoppedAt: at(10), placeId: SAVED,
      setByYou: true, correctionSpan: { startedAt: at(0), stoppedAt: at(60) } });
    expect(result.map((segment) => segment.clientSegmentId)).toEqual(["a", "b"]);
  });

  it("matches an open place up to now", () => {
    const result = applyTimelineCorrections(segments, [correction({ subject: "place", kind: "place", target: { placeId: SAVED } }, 90, 600)], NOW);
    expect(result.find((segment) => segment.clientSegmentId === "b")).toMatchObject({ placeId: SAVED, setByYou: true });
  });

  it("accepts the four kinds the app sends and refuses the rest", () => {
    const parse = (value: unknown) => TimelineCorrectionRequestSchema.safeParse(value).success;
    expect(parse({ kind: "place", subject: "place", itemId: "a", placeId: SAVED, learnedPlaceId: null })).toBe(true);
    expect(parse({ kind: "place", subject: "place", itemId: "a", placeId: SAVED, learnedPlaceId: LEARNED })).toBe(false);
    expect(parse({ kind: "times", subject: "trip", itemId: "t", startedAt: at(1), stoppedAt: at(2) })).toBe(true);
    expect(parse({ kind: "times", subject: "trip", itemId: "t", startedAt: at(2), stoppedAt: at(1) })).toBe(false);
    expect(parse({ kind: "delete", subject: "trip", itemId: "t" })).toBe(true);
    expect(parse({ kind: "delete", subject: "place", itemId: "a" })).toBe(false);
    expect(parse({ kind: "leg_mode", subject: "leg", itemId: "t", legStartedAt: at(70), legStoppedAt: at(90), mode: "bus" })).toBe(true);
    expect(parse({ kind: "leg_mode", subject: "leg", itemId: "t", legStartedAt: at(70), legStoppedAt: at(90), mode: "boat" })).toBe(false);
    expect(parse({ kind: "split", subject: "place", itemId: "a" })).toBe(false);
  });
});
